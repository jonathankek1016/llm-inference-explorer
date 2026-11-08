import type { WorkspaceInstanceId } from './workspace.ts';
import type { Evidence } from './provenance.ts';
import { immutableCopy, validEvidence } from './provenance.ts';
import { conceptRegistry } from './concept-registry.ts';

export type LiveRequestId = string & { readonly liveRequest: unique symbol };
export interface LiveRequestOwner {
  readonly workspace: 'LIVE';
  readonly instanceId: WorkspaceInstanceId;
}
export const liveEventKinds = [
  'request-state',
  'input',
  'preparation',
  'image-metadata',
  'result-media',
  'media-metadata',
  'generation-metadata',
  'request-sent',
  'text-update',
  'result-text',
  'usage',
  'finish-reason',
  'logprobs',
  'probabilities',
  'client-timing',
  'error',
] as const;
export type LiveEventKind = (typeof liveEventKinds)[number];
export interface LiveEvent {
  readonly id: string;
  readonly requestId: LiveRequestId;
  readonly owner: LiveRequestOwner;
  readonly sequence: number;
  /** Browser/app receipt time, never a provider execution timestamp. Sequence defines order. */
  readonly receivedAt: number;
  readonly kind: LiveEventKind;
  readonly conceptId?: string;
  readonly evidence: Evidence<unknown>;
}
export type LiveEventInput = Pick<LiveEvent, 'requestId' | 'kind' | 'conceptId' | 'evidence'>;

/** Append-only per-request evidence. Duplicate/late generations are rejected by the executor. */
export class LiveEventLog {
  private readonly log: LiveEvent[] = [];
  readonly owner: LiveRequestOwner;
  readonly requestId: LiveRequestId;
  private readonly now: () => number;
  constructor(requestId: LiveRequestId, owner: LiveRequestOwner, now = Date.now) {
    this.requestId = requestId;
    this.owner = immutableCopy(owner);
    this.now = now;
  }
  append(input: LiveEventInput): LiveEvent | undefined {
    if (!liveEventKinds.includes(input.kind) || !validEvidence(input.evidence)) return;
    if (input.requestId !== this.requestId || (input.conceptId && !conceptRegistry[input.conceptId])) return;
    const sequence = this.log.length;
    const receivedAt = this.now();
    if (!Number.isFinite(receivedAt)) return;
    const event = immutableCopy({
      ...input,
      id: `${this.requestId}:event:${sequence}`,
      owner: this.owner,
      sequence,
      receivedAt,
    });
    this.log.push(event);
    return event;
  }
  get events(): readonly LiveEvent[] {
    return Object.freeze([...this.log]);
  }
}
