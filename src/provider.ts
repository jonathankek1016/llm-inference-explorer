export interface Candidate {
  token: string;
  logprob: number;
  probability: number;
  chosen: boolean;
}
export interface TokenResult {
  token: string;
  candidates: Candidate[];
}
export interface ProviderResult {
  text: string;
  tokens: TokenResult[];
  usage?: Record<string, number>;
  finishReason?: string;
}
export interface ProviderConfig {
  url: string;
  model: string;
  key: string;
  stream: boolean;
  logprobs: boolean;
}
type RawToken = { token: string; logprob: number; bytes?: number[]; top_logprobs?: RawToken[] };
export function parseTokens(items: RawToken[] | undefined): TokenResult[] {
  return (items || []).map((item) => {
    const identity = (a: RawToken, b: RawToken) =>
      a.bytes && b.bytes ? JSON.stringify(a.bytes) === JSON.stringify(b.bytes) : a.token === b.token;
    const unique: RawToken[] = [item];
    for (const alt of item.top_logprobs || []) if (!unique.some((t) => identity(t, alt))) unique.push(alt);
    return {
      token: item.token,
      candidates: unique
        .map((t) => ({
          token: t.token,
          logprob: t.logprob,
          probability: t.logprob === -9999 ? 0 : Math.exp(t.logprob),
          chosen: identity(t, item),
        }))
        .sort((a, b) => b.probability - a.probability),
    };
  });
}
export function parseCompletion(data: any): ProviderResult {
  if (data.error) throw new Error(data.error.message || 'Provider error');
  const choice = data.choices?.[0];
  if (!choice) throw new Error('The endpoint returned no completion choice.');
  if (choice.message?.refusal) throw new Error(`Provider refusal: ${choice.message.refusal}`);
  if (typeof choice.message?.content !== 'string')
    throw new Error('No text response. This adapter supports text completions.');
  return {
    text: choice.message.content,
    tokens: parseTokens(choice.logprobs?.content),
    usage: data.usage,
    finishReason: choice.finish_reason,
  };
}
export function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Use a base URL without credentials, query or fragment.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use HTTPS, or HTTP for a localhost endpoint.');
  return url.href.replace(/\/$/, '');
}
export async function requestText(
  config: ProviderConfig,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
  onData: (text: string, event: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<ProviderResult> {
  const response = await fetcher(`${validateEndpoint(config.url)}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: config.stream,
      ...(config.logprobs ? { logprobs: true, top_logprobs: 5 } : {}),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      `${response.status}: ${data.error?.message || 'Request failed.'}${config.logprobs ? ' If logprobs are unsupported, disable them in Settings before retrying.' : ''}`,
    );
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const result = parseCompletion(await response.json());
    onData(result.text, 'Final response received');
    return result;
  }
  if (!response.body) throw new Error('The response has no readable stream.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    doneMarker = false,
    finished = false;
  const result: ProviderResult = { text: '', tokens: [] };
  const consume = (frame: string) => {
    const payload = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!payload) return;
    if (payload === '[DONE]') {
      doneMarker = true;
      return;
    }
    const data = JSON.parse(payload);
    if (data.error) throw new Error(data.error.message || 'Stream error');
    if (data.usage) result.usage = data.usage;
    const choice = data.choices?.[0];
    if (!choice) return;
    if (choice.delta?.refusal) throw new Error(`Provider refusal: ${choice.delta.refusal}`);
    if (typeof choice.delta?.content === 'string') {
      result.text += choice.delta.content;
      onData(result.text, 'Stream event received');
    }
    result.tokens.push(...parseTokens(choice.logprobs?.content));
    if (choice.finish_reason) {
      result.finishReason = choice.finish_reason;
      finished = true;
    }
  };
  try {
    while (!doneMarker) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Preserve a trailing CR until the next network read, then normalise CRLF.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) {
        if (buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!doneMarker && !finished)
      throw new Error('Stream ended before completion. Partial text has been preserved.');
    if (!result.text) throw new Error('The provider returned no text.');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
