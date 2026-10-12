import { scenarios } from './content.ts';
import { makeTrace } from './core.ts';
import { demoCompatibilityHost } from './workspace.ts';
import type { WorkspaceInstanceId } from './workspace.ts';

export interface DemoUsage {
  readonly id: string;
  readonly workspace: 'DEMO';
  readonly instanceId: WorkspaceInstanceId;
  readonly conceptId: string;
  readonly scenarioId: string;
  readonly local: boolean;
  readonly stageId: string;
  readonly stageIndex: number;
  readonly stageCount: number;
  readonly occurrence: number;
}
/** Definition locations, never inferred from provider requests or observed runs. */
export interface LiveUsage {
  readonly id: string;
  readonly workspace: 'LIVE';
  readonly instanceId: WorkspaceInstanceId;
  readonly conceptId: string;
  readonly definitionId: string;
  readonly locationId: string;
}
export type ConceptUsage = DemoUsage | LiveUsage;

export function indexUsages(entries: readonly ConceptUsage[]) {
  const byId = new Map<string, ConceptUsage>();
  const byConcept = new Map<string, ConceptUsage[]>();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error(`Duplicate usage location: ${entry.id}`);
    byId.set(entry.id, entry);
    byConcept.set(entry.conceptId, [...(byConcept.get(entry.conceptId) ?? []), entry]);
  }
  return {
    location: (id: string) => byId.get(id),
    forConcept: (id: string): readonly ConceptUsage[] => byConcept.get(id) ?? [],
    entries: [...byId.values()] as readonly ConceptUsage[],
  };
}

// Both authored compute routes use the same definition/filter as the teaching trace.
// Route + stage ID preserves repeated decode/refinement occurrences and shifted indices.
export const usageGraph = indexUsages(
  Object.values(scenarios).flatMap((scenario) =>
    [false, true].flatMap((local) => {
      const trace = makeTrace(scenario.id, local);
      const occurrences = new Map<string, number>();
      return trace.map((stage, stageIndex): DemoUsage => {
        const occurrence = (occurrences.get(stage.conceptId) ?? 0) + 1;
        occurrences.set(stage.conceptId, occurrence);
        return {
          id: `demo:${scenario.id}:${local ? 'local' : 'cloud'}:${stage.id}`,
          workspace: 'DEMO',
          instanceId: demoCompatibilityHost.instanceId!,
          conceptId: stage.conceptId,
          scenarioId: scenario.id,
          local,
          stageId: stage.id,
          stageIndex,
          stageCount: trace.length,
          occurrence,
        };
      });
    }),
  ),
);

/** The single compatibility host cannot replace a retained lesson or an in-flight trace. */
export function demoUsagePresentation(active: boolean, requestRunning: boolean) {
  return active || requestRunning ? 'reference-preview' : 'idle-location';
}
