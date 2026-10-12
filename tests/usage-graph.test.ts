import test from 'node:test';
import assert from 'node:assert/strict';
import { concepts, scenarios } from '../src/content.ts';
import { makeTrace } from '../src/core.ts';
import { demoContext } from '../src/content-overlays.ts';
import { usageGraph, indexUsages, demoUsagePresentation } from '../src/usage-graph.ts';

test('every authored occurrence on both routes resolves bidirectionally without duplicating identities', () => {
  let count = 0;
  for (const scenario of Object.values(scenarios))
    for (const local of [false, true]) {
      const trace = makeTrace(scenario.id, local);
      trace.forEach((stage, stageIndex) => {
        const usage = usageGraph.entries.find(
          (entry) =>
            entry.workspace === 'DEMO' &&
            entry.scenarioId === scenario.id &&
            entry.local === local &&
            entry.stageIndex === stageIndex,
        )!;
        assert.ok(usage && concepts[usage.conceptId]);
        assert.equal(usage.conceptId, stage.conceptId);
        assert.equal(usageGraph.location(usage.id), usage);
        assert.ok(usageGraph.forConcept(stage.conceptId).includes(usage));
        count++;
      });
    }
  assert.equal(usageGraph.entries.length, count);
  assert.equal(new Set(usageGraph.entries.map((entry) => entry.id)).size, count);
  assert.ok(usageGraph.entries.every((entry) => entry.workspace === 'DEMO'));
});

test('zero, single, many and repeated usages remain distinct; Live API is not a Live usage', () => {
  assert.deepEqual(usageGraph.forConcept('attention'), []);
  assert.deepEqual(usageGraph.forConcept('unknown'), []);
  const single = usageGraph.entries[0];
  assert.deepEqual(indexUsages([single]).forConcept(single.conceptId), [single]);
  assert.throws(() => indexUsages([single, single]), /Duplicate usage/);
  const decode = usageGraph
    .forConcept('decode')
    .filter((entry) => entry.workspace === 'DEMO' && entry.scenarioId === 'text' && !entry.local);
  assert.equal(decode.length, 3);
  assert.deepEqual(
    decode.map((entry) => entry.workspace === 'DEMO' && entry.occurrence),
    [1, 2, 3],
  );
  assert.equal(usageGraph.entries.filter((entry) => entry.workspace === 'LIVE').length, 0);
});

test('context overlays reuse authored facts and preserve actual adjacent locations', () => {
  for (const usage of usageGraph.entries) {
    if (usage.workspace !== 'DEMO') continue;
    const context = demoContext(usage);
    const trace = makeTrace(usage.scenarioId, usage.local);
    assert.equal(context.explanation, concepts[usage.conceptId].description);
    assert.equal(context.scenarioContext, scenarios[usage.scenarioId].subtitle);
    assert.deepEqual(context.sourceIds, concepts[usage.conceptId].sources);
    assert.equal(context.previousId, trace[usage.stageIndex - 1]?.conceptId);
    assert.equal(context.nextId, trace[usage.stageIndex + 1]?.conceptId);
  }
});

test('retained incomplete/completed presentations and running requests cannot be replaced by usage navigation', () => {
  assert.equal(demoUsagePresentation(false, false), 'idle-location');
  for (const [active, running] of [
    [true, false],
    [true, true],
    [false, true],
  ])
    assert.equal(demoUsagePresentation(active, running), 'reference-preview');
});
