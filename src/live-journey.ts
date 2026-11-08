import type { ProviderObservation } from './live-observations.ts';
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
  private observationStages = new Map<string, string>();
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
      if (event.kind === 'input')
        this.builder.appendEvent(
          event,
          request.requestType === 'IMAGE_UNDERSTANDING'
            ? 'Your submitted image'
            : request.requestType === 'IMAGE_GENERATION'
              ? 'Your generation prompt'
              : 'Your submitted text',
        );
      else if (event.kind === 'image-metadata') this.builder.appendEvent(event, 'Local image metadata');
      else if (event.kind === 'preparation') this.builder.appendEvent(event, 'Preparing the request');
      else if (event.kind === 'request-sent') {
        this.builder.appendEvent({ ...event, conceptId: 'device' }, 'Request dispatched by this app');
        const exhibits =
          request.requestType === 'IMAGE_UNDERSTANDING'
            ? [
                ['patches', 'An illustrative vision encoder'],
                ['fusion', 'An illustrative multimodal connection'],
              ]
            : request.requestType === 'IMAGE_GENERATION'
              ? [
                  ['conditioning', 'Illustrative text conditioning'],
                  ['noise', 'Illustrative latent noise'],
                  ['denoise', 'An illustrative generation method'],
                ]
              : [['block', 'A representative model concept']];
        for (const [concept, title] of exhibits)
          this.builder.appendTeaching(title, concept, {
            kind: 'ILLUSTRATIVE',
            source: 'AUTHORED',
            basis:
              request.requestType === 'IMAGE_GENERATION'
                ? 'Example diffusion-family teaching model; generation does not prove diffusion, latent noise or denoising steps were used'
                : 'Shared teaching model; the provider architecture and hidden tensors are unknown',
            value:
              'This 3D model explains a concept. It is not a measurement or the actual media result of this request.',
          });
      } else if (
        (event.kind === 'tool-call' || event.kind === 'source-reference') &&
        event.evidence.kind !== 'UNKNOWN'
      ) {
        const observation = event.evidence.value as ProviderObservation;
        const existing = this.observationStages.get(observation.key);
        if (existing) this.builder.annotate(existing, event);
        else {
          const stage = this.builder.appendEvent(
            event,
            event.kind === 'tool-call'
              ? 'Provider requested a function'
              : 'Provider supplied a source reference',
          );
          if (stage) this.observationStages.set(observation.key, stage.id);
        }
      } else if (
        ['text-update', 'result-text', 'result-media', 'error'].includes(event.kind) ||
        (event.kind === 'request-state' &&
          event.evidence.kind !== 'UNKNOWN' &&
          ['FAILED', 'CANCELLED'].includes(String(event.evidence.value)))
      ) {
        if (!this.responseStage)
          this.responseStage = this.builder.appendEvent(
            { ...event, conceptId: event.kind === 'result-media' ? 'image-output' : 'response' },
            event.kind === 'error'
              ? 'Request error'
              : event.kind === 'request-state'
                ? 'Request ended'
                : event.kind === 'result-media'
                  ? 'Returned generated image'
                  : event.kind === 'result-text' && event.evidence.kind === 'UNKNOWN'
                    ? 'No returned text'
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
