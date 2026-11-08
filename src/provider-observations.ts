import type { ProviderObservation, ToolObservation } from './live-observations.ts';
import { safeSourceUrl } from './live-observations.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : undefined;

/** Chat Completions fields only. Text, function names and branding never imply execution. */
export class ChatObservations {
  private calls = new Map<string, ToolObservation>();
  private sources = new Map<string, ProviderObservation>();
  private published = new Map<string, string>();
  private readonly notify: (event: ProviderObservation) => void;
  constructor(notify: (event: ProviderObservation) => void = () => {}) {
    this.notify = notify;
  }
  read(message: unknown, streaming = false) {
    const data = object(message);
    if (!data) return;
    if (Array.isArray(data.tool_calls))
      data.tool_calls.slice(0, 32).forEach((value, position) => {
        const call = object(value);
        if (!call || (call.type !== undefined && call.type !== 'function')) return;
        const index = streaming ? call.index : position;
        if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= 32) return;
        this.call(`tool:${index}`, call.id, call.function, streaming);
      });
    if (data.function_call) this.call('legacy:0', undefined, data.function_call, streaming);
    if (Array.isArray(data.annotations))
      for (const value of data.annotations.slice(0, 64)) {
        const annotation = object(value);
        if (annotation?.type !== 'url_citation') continue;
        const citation = object(annotation.url_citation);
        const url = safeSourceUrl(citation?.url);
        if (!citation || !url) continue;
        const key = `source:${url}:${citation.start_index ?? ''}:${citation.end_index ?? ''}`;
        if (!this.sources.has(key) && this.sources.size >= 64) continue;
        const event: ProviderObservation = {
          kind: 'source-reference',
          key,
          url,
          acquisition: 'UNKNOWN',
          ...(typeof citation.title === 'string' ? { title: citation.title.slice(0, 512) } : {}),
          ...(Number.isSafeInteger(citation.start_index) && Number(citation.start_index) >= 0
            ? { startIndex: Number(citation.start_index) }
            : {}),
          ...(Number.isSafeInteger(citation.end_index) && Number(citation.end_index) >= 0
            ? { endIndex: Number(citation.end_index) }
            : {}),
        };
        this.sources.set(key, event);
        this.emit(event);
      }
  }
  private call(key: string, id: unknown, value: unknown, streaming: boolean) {
    const fn = object(value);
    if (typeof fn?.name !== 'string' && typeof fn?.arguments !== 'string' && typeof id !== 'string') return;
    if (!this.calls.has(key) && this.calls.size >= 32) return;
    const prior = this.calls.get(key);
    let truncated = prior?.truncated ?? false;
    const field = (old: string | undefined, next: unknown, limit: number) => {
      if (typeof next !== 'string') return old;
      const combined = (streaming ? (old ?? '') : '') + next;
      if (combined.length > limit) truncated = true;
      return combined.slice(0, limit);
    };
    const name = field(prior?.name, fn?.name, 256);
    const args = field(prior?.arguments, fn?.arguments, 16384);
    const event: ToolObservation = {
      kind: 'tool-call',
      key,
      ...(typeof id === 'string'
        ? { providerCallId: id.slice(0, 256) }
        : prior?.providerCallId
          ? { providerCallId: prior.providerCallId }
          : {}),
      ...(name !== undefined ? { name } : {}),
      ...(args !== undefined ? { arguments: args } : {}),
      phase: streaming ? 'PARTIAL' : 'RETURNED',
      truncated,
      executionOwner: 'UNKNOWN',
      execution: 'NOT_OBSERVED',
    };
    this.calls.set(key, event);
    this.emit(event);
  }
  /** Transport completion, not tool execution or validation of JSON arguments. */
  finish() {
    for (const [key, call] of this.calls) {
      const event: ToolObservation = { ...call, phase: 'RETURNED' };
      this.calls.set(key, event);
      this.emit(event);
    }
  }
  private emit(event: ProviderObservation) {
    const fingerprint = JSON.stringify(event);
    if (this.published.get(event.key) === fingerprint) return;
    this.published.set(event.key, fingerprint);
    this.notify(Object.freeze({ ...event }));
  }
  get snapshot(): ProviderObservation[] {
    return [...this.calls.values(), ...this.sources.values()].map((event) => ({ ...event }));
  }
}
