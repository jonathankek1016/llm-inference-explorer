import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveRequests, transitionRequest } from '../src/live-request.ts';
import type { LiveRequestState } from '../src/live-request.ts';
import type { LiveRequestOwner } from '../src/live-events.ts';
import type { WorkspaceInstanceId } from '../src/workspace.ts';
import { requestText } from '../src/provider.ts';
import type { ProviderResult } from '../src/provider.ts';
import { liveContext } from '../src/content-overlays.ts';

const owner: LiveRequestOwner = { workspace: 'LIVE', instanceId: 'live:test' as WorkspaceInstanceId };
const config = {
  url: 'https://example.test/v1',
  model: 'test-model',
  key: 'memory-only-secret',
  stream: false,
  logprobs: false,
};
const input = { prompt: 'weather documents calculate 24 * 7', config };
const result: ProviderResult = { text: 'Answer', tokens: [] };
function controlled() {
  const calls: {
    signal: AbortSignal;
    onData: (text: string, event: string) => void;
    resolve: (result: ProviderResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  const transport: typeof requestText = async (_config, _messages, signal, onData) =>
    new Promise((resolve, reject) => {
      calls.push({ signal, onData, resolve, reject });
    });
  return { requests: new LiveRequests({ transport }), calls };
}

test('request transitions enforce the complete lifecycle and reject invalid/terminal transitions', () => {
  const states: LiveRequestState[] = [
    'IDLE',
    'PREPARING',
    'RUNNING',
    'COMPLETING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ];
  const allowed = new Set([
    'IDLE:PREPARING',
    'PREPARING:RUNNING',
    'PREPARING:FAILED',
    'PREPARING:CANCELLED',
    'RUNNING:COMPLETING',
    'RUNNING:FAILED',
    'RUNNING:CANCELLED',
    'COMPLETING:COMPLETED',
    'COMPLETING:FAILED',
    'COMPLETING:CANCELLED',
  ]);
  for (const from of states)
    for (const to of states)
      assert.equal(transitionRequest(from, to), allowed.has(`${from}:${to}`) ? to : from);
});

test('real text transport + mocked JSON response keeps observations, calculations, ownership and credentials separate', async () => {
  let body: any;
  const fetcher: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${config.key}`);
    return Response.json({
      choices: [
        {
          message: { content: 'Returned answer' },
          finish_reason: 'stop',
          logprobs: {
            content: [{ token: 'Returned', logprob: -0.25, top_logprobs: [{ token: 'other', logprob: -2 }] }],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
  };
  let tick = 100;
  const requests = new LiveRequests({
    elapsedClock: () => tick++,
    transport: (c, m, s, onData) => requestText(c, m, s, onData, fetcher),
  });
  const started = requests.start(owner, {
    ...input,
    history: [
      { role: 'user', content: 'Prior', mode: 'live', state: 'completed' },
      { role: 'assistant', content: 'Context', mode: 'live', state: 'completed' },
    ],
  });
  assert.ok(started.accepted);
  assert.match(started.requestId, /^request:/);
  const completed = await started.completion;
  assert.equal(completed.state, 'COMPLETED');
  assert.deepEqual(
    completed.events.filter((e) => e.kind === 'request-state').map((e) => e.evidence.value),
    ['IDLE', 'PREPARING', 'RUNNING', 'COMPLETING', 'COMPLETED'],
  );
  assert.deepEqual(
    completed.events.map((e) => e.sequence),
    completed.events.map((_, i) => i),
  );
  assert.ok(
    completed.events.every(
      (e) => e.requestId === started.requestId && e.owner.instanceId === owner.instanceId,
    ),
  );
  assert.equal(body.messages.at(-1).content, input.prompt);
  assert.equal(body.messages[1].content, 'Prior');
  // Neither prompt vocabulary nor the configured model/endpoint proves hidden execution.
  for (const feature of ['mcp', 'rag', 'webSearch', 'toolCalling'] as const)
    assert.equal(completed.capabilities.backend[feature].support, 'UNKNOWN');
  assert.ok(
    completed.events.every(
      (event) => !event.conceptId || ['device', 'context', 'response'].includes(event.conceptId),
    ),
  );
  assert.equal(completed.result?.text.kind, 'OBSERVED');
  assert.equal(completed.result?.usage.kind, 'OBSERVED');
  assert.equal(completed.result?.logprobs.kind, 'OBSERVED');
  assert.equal(completed.result?.probabilities.kind, 'LOCALLY_CALCULATED');
  assert.equal(completed.events.find((e) => e.kind === 'preparation')?.evidence.kind, 'LOCALLY_CALCULATED');
  assert.equal(completed.events.find((e) => e.kind === 'client-timing')?.evidence.kind, 'LOCALLY_CALCULATED');
  assert.equal(JSON.stringify(completed).includes(config.key), false);
  assert.ok(Object.isFrozen(completed.events[0].owner));
  assert.throws(() => {
    (completed as any).state = 'RUNNING';
  });
  const overlay = liveContext(completed, 'response')!;
  assert.equal(overlay.requestId, started.requestId);
  assert.equal(overlay.instanceId, owner.instanceId);
  assert.equal(overlay.result?.usage.kind, 'OBSERVED');
  assert.ok(overlay.caveats.some((text) => text.includes('illustrative')));
  assert.equal(liveContext(completed, 'invented'), undefined);
});

test('ordered text observations append incrementally through existing SSE parsing; missing fields remain unknown', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let notified!: () => void;
  const update = new Promise<void>((resolve) => {
    notified = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const fetcher: typeof fetch = async () =>
    new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  const requests = new LiveRequests({
    transport: (c, m, s, onData) =>
      requestText(
        c,
        m,
        s,
        (text, event) => {
          onData(text, event);
          notified();
        },
        fetcher,
      ),
  });
  const started = requests.start(owner, { ...input, config: { ...config, stream: true } });
  assert.ok(started.accepted);
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
  await update;
  const partial = requests.get(started.requestId)!;
  assert.equal(partial.state, 'RUNNING');
  assert.equal(partial.events.find((e) => e.kind === 'text-update')?.evidence.value, 'Partial');
  controller.enqueue(
    encoder.encode('data: {"choices":[{"delta":{"content":" answer"}}]}\n\ndata: [DONE]\n\n'),
  );
  controller.close();
  const completed = await started.completion;
  assert.deepEqual(completed.events.slice(0, partial.events.length), partial.events);
  assert.equal(completed.result?.text.value, 'Partial answer');
  for (const field of ['usage', 'finishReason', 'logprobs', 'probabilities'] as const) {
    assert.equal(completed.result?.[field].kind, 'UNKNOWN');
    assert.equal('value' in completed.result![field], false);
  }
});

test('request admission rejects concurrency; explicit cancellation fences stale callbacks and results across owners', async () => {
  const { requests, calls } = controlled();
  assert.equal(requests.current, undefined);
  const first = requests.start(owner, input);
  assert.ok(first.accepted);
  calls[0].onData('partial', 'Stream event received');
  const other = { workspace: 'LIVE' as const, instanceId: 'live:other' as WorkspaceInstanceId };
  assert.deepEqual(requests.start(other, input), {
    accepted: false,
    reason: 'REQUEST_BUSY',
    currentRequestId: first.requestId,
  });
  assert.equal(calls.length, 1);
  assert.equal(requests.cancel(first.requestId), true);
  assert.ok(calls[0].signal.aborted);
  const cancelled = await first.completion;
  assert.equal(cancelled.state, 'CANCELLED');
  const second = requests.start(other, input);
  assert.ok(second.accepted);
  assert.notEqual(first.requestId, second.requestId);
  assert.equal(requests.cancel(first.requestId), false);
  calls[0].onData('stale', 'Stream event received');
  calls[0].resolve({ text: 'stale final', tokens: [] });
  await Promise.resolve();
  assert.deepEqual(requests.get(first.requestId), cancelled);
  assert.equal(requests.current?.id, second.requestId);
  assert.equal(requests.current?.state, 'RUNNING');
  assert.equal(
    requests.current?.events.some((e) => e.evidence.value === 'stale'),
    false,
  );
  calls[1].resolve(result);
  const completed = await second.completion;
  assert.equal(completed.owner.instanceId, other.instanceId);
  calls[1].onData('after completion', 'Stream event received');
  assert.deepEqual(requests.get(second.requestId), completed);
  assert.equal(requests.cancel(second.requestId), false);
});

test('preparation rejects invalid input and known unsupported capability before calling transport', async () => {
  const { requests, calls } = controlled();
  for (const invalid of [
    { ...input, prompt: ' ' },
    { ...input, prompt: 'x'.repeat(6001) },
    { ...input, config: { ...config, model: '' } },
    { ...input, config: { ...config, url: 'https://user:secret@example.test/v1' } },
    { ...input, backendCapabilities: { text: 'UNSUPPORTED' as const } },
  ]) {
    const start = requests.start(owner, invalid);
    assert.ok(start.accepted);
    const failed = await start.completion;
    assert.equal(failed.state, 'FAILED');
    assert.deepEqual(
      failed.events.filter((e) => e.kind === 'request-state').map((e) => e.evidence.value),
      ['IDLE', 'PREPARING', 'FAILED'],
    );
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(requests.start({ workspace: 'DEMO', instanceId: owner.instanceId } as any, input), {
    accepted: false,
    reason: 'INVALID_OWNER',
  });
});

test('transport failure retains partial evidence, sanitizes reflected credentials and permits a later request', async () => {
  const { requests, calls } = controlled();
  const start = requests.start(owner, input);
  assert.ok(start.accepted);
  calls[0].onData('partial answer', 'Stream event received');
  calls[0].reject(new Error(`401 rejected ${config.key}`));
  const failed = await start.completion;
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.error?.value, '401 rejected [redacted]');
  assert.equal(failed.events.find((e) => e.kind === 'text-update')?.evidence.value, 'partial answer');
  assert.equal(failed.result, undefined);
  assert.equal(JSON.stringify(failed).includes(config.key), false);
  const next = requests.start(owner, input);
  assert.ok(next.accepted);
  calls[1].resolve(result);
  await next.completion;
  assert.deepEqual(requests.get(start.requestId), failed);
});
