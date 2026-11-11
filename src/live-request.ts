import { safeRequestError } from './request-errors.ts';
import type { ProviderObservation } from './live-observations.ts';
import type { LiveRequestType } from './live-input.ts';
import { validateImage, imageMetadata } from './live-media.ts';
import type { ImageInput, GeneratedImage } from './live-media.ts';
import { RunGate, boundedContext } from './core.ts';
import type { Message } from './core.ts';
import {
  requestText,
  requestImageUnderstanding,
  requestImageGeneration,
  validateEndpoint,
} from './provider.ts';
import type { ProviderConfig, ProviderResult } from './provider.ts';
import {
  textCapabilities,
  checkTextCapabilities,
  mediaCapabilities,
  checkMediaCapabilities,
} from './live-capabilities.ts';
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
  readonly requestType?: LiveRequestType;
  readonly media?: readonly GeneratedImage[];
  readonly inputImage?: ImageInput;
  readonly capabilities: LiveCapabilities;
  readonly events: readonly LiveEvent[];
  readonly result?: LiveTextResult;
  readonly error?: Evidence<string>;
}
interface LiveInputBase {
  readonly prompt: string;
  readonly history?: readonly Message[];
  readonly config: ProviderConfig;
  /** Explicit declarations only; neither endpoint branding nor prompt keywords supply these. */
  readonly backendCapabilities?: Partial<Record<LiveFeature, CapabilitySupport>>;
}
export interface LiveTextInput extends LiveInputBase {
  readonly requestType?: 'TEXT';
  readonly image?: never;
}
export interface LiveImageInput extends LiveInputBase {
  readonly requestType: 'IMAGE_UNDERSTANDING';
  readonly image: ImageInput;
}
export interface LiveGenerationInput extends LiveInputBase {
  readonly requestType: 'IMAGE_GENERATION';
  readonly image?: never;
}
export type LiveInput = LiveTextInput | LiveImageInput | LiveGenerationInput;
export type RequestAdmission =
  | { accepted: true; requestId: LiveRequestId; completion: Promise<LiveRequestSnapshot> }
  | { accepted: false; reason: 'REQUEST_BUSY'; currentRequestId: LiveRequestId }
  | { accepted: false; reason: 'INVALID_OWNER' };
interface RequestRecord {
  id: LiveRequestId;
  owner: LiveRequestOwner;
  state: LiveRequestState;
  requestType: LiveRequestType;
  media?: readonly GeneratedImage[];
  inputImage?: ImageInput;
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
  private readonly imageTransport: typeof requestImageUnderstanding;
  private readonly generationTransport: typeof requestImageGeneration;
  private readonly now: () => number;
  private readonly elapsedClock: () => number;
  constructor(
    options: {
      imageTransport?: typeof requestImageUnderstanding;
      generationTransport?: typeof requestImageGeneration;
      transport?: typeof requestText;
      now?: () => number;
      elapsedClock?: () => number;
    } = {},
  ) {
    this.transport = options.transport ?? requestText;
    this.imageTransport = options.imageTransport ?? requestImageUnderstanding;
    this.generationTransport = options.generationTransport ?? requestImageGeneration;
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
        requestType: record.requestType,
        media: record.media,
        inputImage: record.inputImage,
        capabilities: record.capabilities,
        events: record.log.events,
        result: record.result,
        error: record.error,
      })
    );
  }
  start(owner: LiveRequestOwner, input: LiveInput): RequestAdmission {
    if (owner.workspace !== 'LIVE' || !owner.instanceId) return { accepted: false, reason: 'INVALID_OWNER' };
    const current = this.latest && this.records.get(this.latest);
    if (current && !requestTerminal(current.state))
      return { accepted: false, reason: 'REQUEST_BUSY', currentRequestId: current.id };
    // Keep no media archive when an explicit new request replaces the latest result.
    for (const prior of this.records.values()) {
      prior.media = undefined;
      prior.inputImage = undefined;
    }
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
      requestType: input.requestType ?? 'TEXT',
      generation: run.id,
      capabilities:
        !input.requestType || input.requestType === 'TEXT'
          ? textCapabilities(input.backendCapabilities)
          : mediaCapabilities(input.requestType, input.backendCapabilities),
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
    record.settle = () => {}; // Do not retain the fulfilled promise and its media snapshot.
  }
  private async execute(record: RequestRecord, input: LiveInput, signal: AbortSignal) {
    try {
      if (
        (record.requestType !== 'IMAGE_UNDERSTANDING' && !input.prompt.trim()) ||
        input.prompt.length > 6000
      )
        throw new Error('Enter a prompt between 1 and 6,000 characters.');
      if (!input.config.model.trim()) throw new Error('Configure a model before requesting.');
      const endpoint = validateEndpoint(input.config.url);
      const unsupported =
        record.requestType === 'TEXT'
          ? checkTextCapabilities(record.capabilities, input.config)
          : checkMediaCapabilities(record.capabilities, record.requestType, input.config);
      if (record.requestType === 'IMAGE_UNDERSTANDING') {
        if (!input.image) throw new Error('Choose an image before submitting.');
        validateImage(input.image);
        record.inputImage = Object.freeze({ ...input.image });
      }
      if (unsupported.length)
        throw new Error(`Unsupported requested capabilities: ${unsupported.join(', ')}`);
      record.log.append({
        requestId: record.id,
        kind: 'input',
        conceptId: record.requestType === 'IMAGE_UNDERSTANDING' ? 'image' : 'device',
        evidence: observed(
          record.inputImage ? { instruction: input.prompt, imageId: record.inputImage.id } : input.prompt,
          'APPLICATION',
          record.inputImage
            ? 'User-submitted image and optional instruction; payload retained separately in memory'
            : 'Submitted text; no hidden capability classification from words',
        ),
      });
      if (record.inputImage)
        record.log.append({
          requestId: record.id,
          kind: 'image-metadata',
          conceptId: 'image',
          evidence: calculated(
            imageMetadata(record.inputImage),
            'Browser-decoded dimensions, file MIME and byte size; not provider telemetry',
          ),
        });
      const messages = boundedContext([...(input.history ?? [])], input.prompt);
      record.log.append({
        requestId: record.id,
        kind: 'preparation',
        conceptId: record.requestType === 'IMAGE_UNDERSTANDING' ? 'image' : 'context',
        evidence: calculated(
          record.requestType === 'TEXT'
            ? { modality: 'text', messages }
            : {
                requestType: record.requestType,
                prompt: input.prompt,
                ...(record.inputImage ? { image: imageMetadata(record.inputImage) } : {}),
              },
          record.requestType === 'TEXT'
            ? 'Text input contract and existing bounded-context assembly; not provider token counts'
            : 'App-side payload assembly; image bytes are not included in event logs',
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
            requestType: record.requestType,
            model: input.config.model,
            streamRequested: input.config.stream,
            logprobsRequested: input.config.logprobs,
          },
          'APPLICATION',
          'Transport invoked with these options; this is not proof of backend support or receipt',
        ),
      });
      this.publish(record);
      const onText = (text: string) => {
        if (!this.accepts(record) || record.state !== 'RUNNING') return;
        record.log.append({
          requestId: record.id,
          kind: 'text-update',
          conceptId: 'response',
          evidence: observed(text, 'PROVIDER', 'Cumulative returned text; not hidden model activations'),
        });
        this.publish(record);
      };
      const observations = new Map<string, string>();
      const onObservation = (event: ProviderObservation) => {
        if (!this.accepts(record) || record.state !== 'RUNNING') return;
        const fingerprint = JSON.stringify(event);
        if (observations.get(event.key) === fingerprint) return;
        observations.set(event.key, fingerprint);
        record.log.append({
          requestId: record.id,
          kind: event.kind,
          conceptId: event.kind === 'tool-call' ? 'intent' : 'response',
          evidence: observed(
            event,
            'PROVIDER',
            event.kind === 'tool-call'
              ? 'Structured function call returned by the provider; arguments are untrusted data. Execution and results are not observed. This app has no tool executor.'
              : 'Structured provider citation, not a verified source or proof that web search or retrieval ran',
          ),
        });
        this.publish(record);
      };
      if (record.requestType === 'IMAGE_GENERATION') {
        const output = await this.generationTransport(input.config, input.prompt, signal);
        if (!this.accepts(record)) return;
        this.move(record, 'COMPLETING');
        record.media = immutableCopy(output.media);
        record.result = {
          ...resultEvidence({ text: '', tokens: [], usage: output.usage }),
          text: unknown('Image-generation endpoint returned media, not text'),
        };
        record.log.append({
          requestId: record.id,
          kind: 'result-media',
          conceptId: 'image-output',
          evidence: observed(
            output.media.map(({ id, revisedPrompt }) => ({ mediaId: id, revisedPrompt })),
            'PROVIDER',
            'App-assigned references to media actually returned by the provider, available in Request & result. The 3D model is illustrative.',
          ),
        });
        record.log.append({
          requestId: record.id,
          kind: 'media-metadata',
          conceptId: 'image-output',
          evidence: calculated(
            output.media.map(({ id, mime }) => ({ mediaId: id, mime })),
            'App media identity and MIME recognized from raster signatures where available; URL media type is unknown until browser decoding',
          ),
        });
        record.log.append({
          requestId: record.id,
          kind: 'generation-metadata',
          conceptId: 'image-output',
          evidence: Object.keys(output.metadata).length
            ? observed(
                output.metadata,
                'PROVIDER',
                'Only explicitly returned generation fields; hidden sampler and denoising progress are unknown',
              )
            : unknown('No generation metadata was returned'),
        });
        record.log.append({
          requestId: record.id,
          kind: 'usage',
          conceptId: 'image-output',
          evidence: record.result.usage,
        });
        this.finish(record, 'COMPLETED');
        return;
      }
      const result =
        record.requestType === 'IMAGE_UNDERSTANDING'
          ? await this.imageTransport(
              input.config,
              record.inputImage!,
              input.prompt,
              signal,
              onText,
              undefined,
              onObservation,
            )
          : await this.transport(input.config, messages, signal, onText, undefined, onObservation);
      if (!this.accepts(record)) return;
      for (const event of result.observations ?? []) onObservation(event);
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
      const safe = safeRequestError(error, input.config.key, input.image?.dataUrl);
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
    text:
      result.textReturned === false
        ? unknown('No text content was returned; structured calls do not imply a text answer or tool result')
        : observed(result.text, 'PROVIDER', 'Returned text parsed by the existing adapter'),
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
