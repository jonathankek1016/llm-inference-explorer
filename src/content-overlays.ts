import { concepts, scenarios } from './content.ts';
import { conceptRegistry } from './concept-registry.ts';
import { makeTrace } from './core.ts';
import type { DemoUsage } from './usage-graph.ts';
import type { GuidedSessionId, WorkspaceInstanceId } from './workspace.ts';
import type { LiveRequestId, LiveEvent } from './live-events.ts';
import type { LiveRequestSnapshot, LiveRequestState, LiveTextResult } from './live-request.ts';
import type { LiveCapabilities } from './live-capabilities.ts';
import type { Evidence } from './provenance.ts';
import { immutableCopy } from './provenance.ts';

/** A projection of existing authored material, not another encyclopedia record. */
export function demoContext(usage: DemoUsage) {
  const concept = conceptRegistry[usage.conceptId];
  const scenario = scenarios[usage.scenarioId];
  const steps = makeTrace(scenario.id, usage.local).map((event) => event.conceptId);
  return {
    concept,
    scenarioTitle: scenario.name,
    scenarioContext: scenario.subtitle,
    explanation: concepts[concept.id].description,
    input: concepts[concept.id].input,
    output: concepts[concept.id].output,
    previousId: steps[usage.stageIndex - 1],
    nextId: steps[usage.stageIndex + 1],
    sourceIds: concept.sourceIds,
  };
}

/** Runtime projection only; Part 7 owns the user-facing Live Inspector. */
export interface LiveContextOverlay {
  readonly workspace: 'LIVE';
  readonly instanceId: WorkspaceInstanceId;
  readonly conceptId: string;
  readonly requestId: LiveRequestId;
  readonly state: LiveRequestState;
  readonly sessionId?: GuidedSessionId;
  readonly evidence: readonly LiveEvent[];
  readonly capabilities: LiveCapabilities;
  readonly result?: LiveTextResult;
  readonly error?: Evidence<string>;
  readonly caveats: readonly string[];
}

export function liveContext(request: LiveRequestSnapshot, conceptId: string): LiveContextOverlay | undefined {
  if (!conceptRegistry[conceptId]) return;
  return immutableCopy({
    workspace: 'LIVE',
    instanceId: request.owner.instanceId,
    requestId: request.id,
    conceptId,
    state: request.state,
    capabilities: request.capabilities,
    result: request.result,
    error: request.error,
    evidence: request.events.filter((event) => !event.conceptId || event.conceptId === conceptId),
    caveats: [
      'Concept association does not prove this architecture was executed by the provider.',
      '3D models and teaching particles are illustrative, not observed telemetry.',
      'Client timestamps and elapsed time do not expose provider queues, network routes or tensors.',
      'Client cancellation does not prove that remote computation stopped.',
    ],
  });
}
