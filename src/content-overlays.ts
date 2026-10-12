import { concepts, scenarios } from './content.ts';
import { conceptRegistry } from './concept-registry.ts';
import { makeTrace } from './core.ts';
import type { DemoUsage } from './usage-graph.ts';
import type { GuidedSessionId, WorkspaceInstanceId } from './workspace.ts';

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

/** Future adapter input only. No Live definitions or fabricated evidence are instantiated. */
export interface LiveContextOverlay {
  readonly workspace: 'LIVE';
  readonly instanceId: WorkspaceInstanceId;
  readonly conceptId: string;
  readonly requestId: string;
  readonly sessionId?: GuidedSessionId;
  readonly evidence: readonly {
    readonly label: string;
    readonly value: string;
    readonly provenance: 'provider' | 'application';
  }[];
  readonly caveats: readonly string[];
}
