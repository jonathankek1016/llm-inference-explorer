import { createJourneyControl, transitionJourney, advanceJourneyTime, journeyAdvancing } from './core.ts';
import type { JourneyAction, TraceEvent } from './core.ts';
import { LiveTraceBuilder } from './live-trace.ts';
import type { LiveTraceStage } from './live-trace.ts';
import type { LiveRequestSnapshot } from './live-request.ts';
import { teachingDuration } from './framing.ts';

/** One request's educational projection. No transport, global admission or camera ownership. */
export class LiveJourney {
  control = createJourneyControl();
  position = 0;
  elapsed = 0;
  speed = 1;
  private builder?: LiveTraceBuilder;
  private sequence = -1;
  private responseStage?: string;
  private retained?: readonly LiveTraceStage[];
  get requestId() {
    return this.builder?.requestId;
  }
  get stages() {
    return this.retained ?? this.builder?.snapshot ?? [];
  }
  get current() {
    return this.stages[this.position];
  }
  get event(): TraceEvent | undefined {
    const stage = this.current;
    return (
      stage && {
        runId: 0,
        scenarioId: 'live-text',
        id: stage.id,
        kind: stage.conceptId ?? 'response',
        conceptId: stage.conceptId ?? 'response',
        source: 'Illustrative',
        duration: 6000,
        payload: {},
      }
    );
  }
  receive(request: LiveRequestSnapshot) {
    if (this.builder && this.builder.requestId !== request.id) return;
    this.builder ??= new LiveTraceBuilder(request.id, request.owner);
    for (const event of request.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.kind === 'input') this.builder.appendEvent(event, 'Your submitted text');
      else if (event.kind === 'preparation') this.builder.appendEvent(event, 'Preparing the request');
      else if (event.kind === 'request-sent') {
        this.builder.appendEvent({ ...event, conceptId: 'device' }, 'Request dispatched by this app');
        this.builder.appendTeaching('A representative model concept', 'block', {
          kind: 'ILLUSTRATIVE',
          source: 'AUTHORED',
          basis: 'Shared transformer teaching model; the provider architecture is unknown',
          value: 'This model explains a concept. It is not a measurement of this request.',
        });
      } else if (
        ['text-update', 'result-text', 'error'].includes(event.kind) ||
        (event.kind === 'request-state' &&
          event.evidence.kind !== 'UNKNOWN' &&
          ['FAILED', 'CANCELLED'].includes(String(event.evidence.value)))
      ) {
        if (!this.responseStage)
          this.responseStage = this.builder.appendEvent(
            { ...event, conceptId: 'response' },
            event.kind === 'error'
              ? 'Request error'
              : event.kind === 'request-state'
                ? 'Request ended'
                : 'Returned response',
          )?.id;
        else this.builder.annotate(this.responseStage, event);
      } else if (this.responseStage) this.builder.annotate(this.responseStage, event);
    }
  }
  action(action: JourneyAction) {
    if (action.type === 'COMPLETE') this.retained = this.stages;
    this.control = transitionJourney(this.control, action);
  }
  restart() {
    this.retained = undefined;
    this.position = 0;
    this.elapsed = 0;
    this.action({ type: 'START' });
  }
  seek(position: number) {
    this.retained = undefined;
    this.position = Math.max(0, Math.min(this.stages.length - 1, Math.floor(position)));
    this.elapsed = 0;
  }
  tick(delta: number): boolean {
    this.elapsed = advanceJourneyTime(this.control, this.elapsed, delta, this.speed);
    if (!this.event || !journeyAdvancing(this.control) || this.elapsed < teachingDuration(this.event, false))
      return false;
    if (this.position < this.stages.length - 1) this.seek(this.position + 1);
    else this.action({ type: 'COMPLETE' });
    return true;
  }
}
