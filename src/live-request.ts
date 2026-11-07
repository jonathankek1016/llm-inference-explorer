import { RunGate, boundedContext } from './core.ts';
import type { Message } from './core.ts';
import { requestText, validateEndpoint } from './provider.ts';
import type { ProviderConfig, ProviderResult } from './provider.ts';
import { textCapabilities, checkTextCapabilities } from './live-capabilities.ts';
import type { CapabilitySupport, LiveCapabilities, LiveFeature } from './live-capabilities.ts';
import { LiveEventLog } from './live-events.ts';
import type { LiveEvent, LiveRequestId, LiveRequestOwner } from './live-events.ts';
import { observed, calculated, unknown, immutableCopy } from './provenance.ts';
import type { Evidence } from './provenance.ts';

export type LiveRequestState =
  'IDLE' | 'PREPARING' | 'RUNNING' | 'COMPLETING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
const transitions: Record<LiveRequestState, readonly LiveRequestState[]> = {
  IDLE: ['PREPARING'],
  PREPARING: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['COMPLETING', 'FAILED', 'CANCELLED'],
  COMPLETING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};
export function transitionRequest(state: LiveRequestState, next: LiveRequestState): LiveRequestState {
  return transitions[state]?.includes(next) ? next : state;
}
export const requestTerminal = (state: LiveRequestState) =>
  ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state);

export interface LiveTextResult {
  readonly text: Evidence<string>;
  readonly usage: Evidence<Readonly<Record<string, number>>>;
  readonly finishReason: Evidence<string>;
  readonly logprobs: Evidence<
    readonly { token: string; candidates: readonly { token: string; logprob: number }[] }[]
  >;
  readonly probabilities: Evidence<
    readonly {
      token: string;
      candidates: readonly { token: string; probability: number; chosen: boolean }[];
    }[]
  >;
}
export interface LiveRequestSnapshot {
  readonly id: LiveRequestId;
  readonly owner: LiveRequestOwner;
  readonly state: LiveRequestState;
  readonly capabilities: LiveCapabilities;
  readonly events: readonly LiveEvent[];
  readonly result?: LiveTextResult;
  readonly error?: Evidence<string>;
}
export interface LiveTextInput {
  readonly prompt: string;
  readonly history?: readonly Message[];
  readonly config: ProviderConfig;
  /** Explicit declarations only; neither endpoint branding nor prompt keywords supply these. */
  readonly backendCapabilities?: Partial<Record<LiveFeature, CapabilitySupport>>;
}
export type RequestAdmission =
  | { accepted: true; requestId: LiveRequestId; completion: Promise<LiveRequestSnapshot> }
  | { accepted: false; reason: 'REQUEST_BUSY'; currentRequestId: LiveRequestId }
  | { accepted: false; reason: 'INVALID_OWNER' };
interface RequestRecord {
  id: LiveRequestId;
  owner: LiveRequestOwner;
  state: LiveRequestState;
  generation: number;
  capabilities: LiveCapabilities;
  log: LiveEventLog;
  started: number;
  result?: LiveTextResult;
  error?: Evidence<string>;
  settle: (snapshot: LiveRequestSnapshot) => void;
}

/** One in-flight execution per service, shared by its Live instances. New starts
 * are rejected until explicit cancellation or a terminal result; never replaced.
 * No journey, global session, root selection, renderer, persistence or credentials store. */
export class LiveRequests {
  private readonly listeners = new Set<(snapshot: LiveRequestSnapshot) => void>();
  subscribe(listener: (snapshot: LiveRequestSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private publish(record: RequestRecord) {
    const snapshot = this.get(record.id)!;
    // Deliver immutable transition snapshots after start() has returned its identity.
    queueMicrotask(() => this.listeners.forEach((listener) => listener(snapshot)));
  }
  private readonly gate = new RunGate();
  private readonly records = new Map<LiveRequestId, RequestRecord>();
  private latest?: LiveRequestId;
  private readonly transport: typeof requestText;
  private readonly now: () => number;
  private readonly elapsedClock: () => number;
  constructor(
    options: { transport?: typeof requestText; now?: () => number; elapsedClock?: () => number } = {},
  ) {
    this.transport = options.transport ?? requestText;
    this.now = options.now ?? Date.now;
    this.elapsedClock = options.elapsedClock ?? (() => performance.now());
  }
  get current(): LiveRequestSnapshot | undefined {
    return this.latest ? this.get(this.latest) : undefined;
  }
  get(id: LiveRequestId): LiveRequestSnapshot | undefined {
    const record = this.records.get(id);
    return (
      record &&
      immutableCopy({
        id,
        owner: record.owner,
        state: record.state,
        capabilities: record.capabilities,
        events: record.log.events,
        result: record.result,
        error: record.error,
      })
    );
  }
  start(owner: LiveRequestOwner, input: LiveTextInput): RequestAdmission {
    if (owner.workspace !== 'LIVE' || !owner.instanceId) return { accepted: false, reason: 'INVALID_OWNER' };
    const current = this.latest && this.records.get(this.latest);
    if (current && !requestTerminal(current.state))
      return { accepted: false, reason: 'REQUEST_BUSY', currentRequestId: current.id };
    const id = `request:${crypto.randomUUID()}` as LiveRequestId;
    const run = this.gate.start(); // stale-callback token only, not request identity
    let settle!: RequestRecord['settle'];
    const completion = new Promise<LiveRequestSnapshot>((resolve) => {
      settle = resolve;
    });
    const record: RequestRecord = {
      id,
      owner: immutableCopy(owner),
      state: 'IDLE',
      generation: run.id,
      capabilities: textCapabilities(input.backendCapabilities),
      log: new LiveEventLog(id, owner, this.now),
      started: this.elapsedClock(),
      settle,
    };
    this.records.set(id, record);
    this.latest = id;
    this.recordState(record);
    this.move(record, 'PREPARING');
    // Copy settings for this invocation only. Keys are never included in records/events.
    void this.execute(
      record,
      { ...input, config: { ...input.config }, history: input.history?.map((m) => ({ ...m })) },
      run.signal,
    );
    return { accepted: true, requestId: id, completion };
  }
  cancel(id: LiveRequestId): boolean {
    const record = this.records.get(id);
    if (!record || !this.accepts(record)) return false;
    this.gate.cancel();
    this.finish(record, 'CANCELLED');
    return true;
  }
  private accepts(record: RequestRecord) {
    return (
      this.latest === record.id && this.gate.current(record.generation) && !requestTerminal(record.state)
    );
  }
  private recordState(record: RequestRecord) {
    record.log.append({
      requestId: record.id,
      kind: 'request-state',
      evidence: observed(record.state, 'APPLICATION', 'Local request lifecycle transition'),
    });
    this.publish(record);
  }
  private move(record: RequestRecord, next: LiveRequestState) {
    if (transitionRequest(record.state, next) === record.state) return false;
    record.state = next;
    this.recordState(record);
    return true;
  }
  private finish(record: RequestRecord, state: 'COMPLETED' | 'FAILED' | 'CANCELLED') {
    record.log.append({
      requestId: record.id,
      kind: 'client-timing',
      evidence: calculated(
        Math.max(0, this.elapsedClock() - record.started),
        'Milliseconds on the client monotonic clock since preparation; not provider latency',
      ),
    });
    this.move(record, state);
    if (state !== 'CANCELLED')
      this.gate.finish(record.generation, state === 'COMPLETED' ? 'completed' : 'error');
    record.settle(this.get(record.id)!);
  }
  private async execute(record: RequestRecord, input: LiveTextInput, signal: AbortSignal) {
    try {
      if (!input.prompt.trim() || input.prompt.length > 6000)
        throw new Error('Enter a prompt between 1 and 6,000 characters.');
      if (!input.config.model.trim()) throw new Error('Configure a text model before requesting.');
      const endpoint = validateEndpoint(input.config.url);
      const unsupported = checkTextCapabilities(record.capabilities, input.config);
      if (unsupported.length)
        throw new Error(`Unsupported requested capabilities: ${unsupported.join(', ')}`);
      record.log.append({
        requestId: record.id,
        kind: 'input',
        conceptId: 'device',
        evidence: observed(
          input.prompt,
          'APPLICATION',
          'Submitted text; no hidden capability classification from words',
        ),
      });
      const messages = boundedContext([...(input.history ?? [])], input.prompt);
      record.log.append({
        requestId: record.id,
        kind: 'preparation',
        conceptId: 'context',
        evidence: calculated(
          { modality: 'text', messages },
          'Text input contract and existing bounded-context assembly; not provider token counts',
        ),
      });
      if (!this.accepts(record)) return;
      this.move(record, 'RUNNING');
      record.log.append({
        requestId: record.id,
        kind: 'request-sent',
        evidence: observed(
          {
            endpoint,
            model: input.config.model,
            streamRequested: input.config.stream,
            logprobsRequested: input.config.logprobs,
          },
          'APPLICATION',
          'Transport invoked with these options; this is not proof of backend support or receipt',
        ),
      });
      this.publish(record);
      const result = await this.transport(input.config, messages, signal, (text) => {
        if (!this.accepts(record) || record.state !== 'RUNNING') return;
        record.log.append({
          requestId: record.id,
          kind: 'text-update',
          conceptId: 'response',
          evidence: observed(
            text,
            'PROVIDER',
            'Cumulative text exposed by the existing transport; not a raw network packet or token boundary',
          ),
        });
        this.publish(record);
      });
      if (!this.accepts(record)) return;
      this.move(record, 'COMPLETING');
      record.result = resultEvidence(result);
      const fields = [
        ['result-text', record.result.text],
        ['usage', record.result.usage],
        ['finish-reason', record.result.finishReason],
        ['logprobs', record.result.logprobs],
        ['probabilities', record.result.probabilities],
      ] as const;
      for (const [kind, evidence] of fields)
        record.log.append({ requestId: record.id, kind, conceptId: 'response', evidence });
      this.finish(record, 'COMPLETED');
    } catch (error) {
      if (!this.accepts(record)) return;
      const message = error instanceof Error ? error.message : 'Request failed';
      const safe = (input.config.key ? message.split(input.config.key).join('[redacted]') : message).slice(
        0,
        2000,
      );
      record.error = observed(
        safe,
        'APPLICATION',
        'Validation/transport error surfaced by the app; not hidden provider telemetry',
      );
      record.log.append({ requestId: record.id, kind: 'error', evidence: record.error });
      this.finish(record, 'FAILED');
    }
  }
}

function resultEvidence(result: ProviderResult): LiveTextResult {
  return immutableCopy({
    text: observed(result.text, 'PROVIDER', 'Returned text parsed by the existing adapter'),
    usage: result.usage
      ? observed(result.usage, 'PROVIDER', 'Explicit returned usage fields')
      : unknown('Usage was not returned'),
    finishReason:
      result.finishReason != null
        ? observed(result.finishReason, 'PROVIDER', 'Explicit returned finish reason')
        : unknown('Finish reason was not returned'),
    logprobs: result.tokens.length
      ? observed(
          result.tokens.map((token) => ({
            token: token.token,
            candidates: token.candidates.map((candidate) => ({
              token: candidate.token,
              logprob: candidate.logprob,
            })),
          })),
          'PROVIDER',
          'Returned token/logprob fields, normalized and deduplicated by the adapter; not hidden activations',
        )
      : unknown('Logprobs were not returned'),
    probabilities: result.tokens.length
      ? calculated(
          result.tokens.map((token) => ({
            token: token.token,
            candidates: token.candidates.map(({ token, probability, chosen }) => ({
              token,
              probability,
              chosen,
            })),
          })),
          'Existing adapter: exp(logprob), -9999 sentinel maps to zero; candidate deduplication/selection matching; no renormalisation',
        )
      : unknown('No logprobs from which to calculate probabilities'),
  });
}
