import type { LiveEvent, LiveRequestId, LiveRequestOwner } from './live-events.ts';
import { liveEventKinds } from './live-events.ts';
import type { Evidence } from './provenance.ts';
import { immutableCopy, validEvidence } from './provenance.ts';
import { conceptRegistry } from './concept-registry.ts';

export interface LiveTraceStage {
  readonly id: string;
  readonly title: string;
  readonly conceptId?: string;
  readonly evidence: Evidence<unknown>;
  readonly events: readonly LiveEvent[];
}
/** Data only. Appending/enriching never seeks, renumbers, or rewrites a journey frame. */
export class LiveTraceBuilder {
  private readonly stages: LiveTraceStage[] = [];
  private lastSequence = -1;
  readonly requestId: LiveRequestId;
  readonly owner: LiveRequestOwner;
  constructor(requestId: LiveRequestId, owner: LiveRequestOwner) {
    this.requestId = requestId;
    this.owner = immutableCopy(owner);
  }
  private accepts(event: LiveEvent) {
    return (
      validEvidence(event.evidence) &&
      liveEventKinds.includes(event.kind) &&
      Number.isSafeInteger(event.sequence) &&
      event.sequence >= 0 &&
      Number.isFinite(event.receivedAt) &&
      event.id === `${event.requestId}:event:${event.sequence}` &&
      (!event.conceptId || !!conceptRegistry[event.conceptId]) &&
      event.requestId === this.requestId &&
      event.owner.workspace === this.owner.workspace &&
      event.owner.instanceId === this.owner.instanceId &&
      event.sequence > this.lastSequence
    );
  }
  appendEvent(event: LiveEvent, title: string): LiveTraceStage | undefined {
    if (!this.accepts(event)) return;
    const stage = this.append(title, event.evidence, event.conceptId, [event]);
    this.lastSequence = event.sequence;
    return stage;
  }
  appendTeaching(
    title: string,
    conceptId: string,
    evidence: Extract<Evidence<unknown>, { kind: 'ILLUSTRATIVE' | 'INFERRED_REPRESENTATIVE' | 'UNKNOWN' }>,
  ) {
    if (
      !validEvidence(evidence) ||
      !conceptRegistry[conceptId] ||
      !['ILLUSTRATIVE', 'INFERRED_REPRESENTATIVE', 'UNKNOWN'].includes(evidence.kind)
    )
      return;
    return this.append(title, evidence, conceptId, []);
  }
  /** Late evidence is an annotation; it never promotes the stage's original provenance. */
  annotate(stageId: string, event: LiveEvent): boolean {
    const index = this.stages.findIndex((stage) => stage.id === stageId);
    if (index < 0 || !this.accepts(event)) return false;
    const stage = this.stages[index];
    this.stages[index] = immutableCopy({ ...stage, events: [...stage.events, event] });
    this.lastSequence = event.sequence;
    return true;
  }
  private append(
    title: string,
    evidence: Evidence<unknown>,
    conceptId: string | undefined,
    events: readonly LiveEvent[],
  ) {
    const stage = immutableCopy({
      id: `${this.requestId}:stage:${this.stages.length}`,
      title,
      conceptId,
      evidence,
      events,
    });
    this.stages.push(stage);
    return stage;
  }
  get snapshot(): readonly LiveTraceStage[] {
    return Object.freeze([...this.stages]);
  }
}
