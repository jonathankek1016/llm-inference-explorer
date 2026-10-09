import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concepts, relationships, scenarios, sources } from '../src/content.ts';
import {
  conceptRegistry,
  exploreCategories,
  exploreReference,
  referenceSources,
  categoryPath,
  childCategories,
  categoryConceptCount,
  searchConceptRegistry,
} from '../src/concept-registry.ts';
import { initialExploreState, navigateExplore } from '../src/explore.ts';

test('all 32 released identities and Demo references resolve through one shared catalog', () => {
  assert.deepEqual(Object.keys(conceptRegistry), Object.keys(concepts));
  assert.equal(Object.keys(conceptRegistry).length, 32);
  for (const scenario of Object.values(scenarios))
    for (const id of scenario.steps) assert.ok(conceptRegistry[id], `${scenario.id}: ${id}`);
  for (const shared of Object.values(conceptRegistry)) {
    const original = concepts[shared.id];
    assert.equal(shared.title, original.title);
    assert.equal(shared.summary, original.short);
    assert.deepEqual(shared.anchor, { scene: original.scene, conceptId: original.id });
    assert.equal(shared.sourceIds, original.sources);
    assert.equal(exploreReference(shared.id)!.input, original.input);
    assert.equal(exploreReference(shared.id)!.output, original.output);
    for (const id of original.related) assert.ok(shared.connectedIds.includes(id));
    for (const id of shared.connectedIds) assert.ok(conceptRegistry[id]);
    for (const source of referenceSources(shared.id)) assert.equal(source.url, sources[source.id].url);
  }
  for (const edge of relationships) {
    assert.ok(conceptRegistry[edge.from].relationships.includes(edge));
    assert.ok(conceptRegistry[edge.to].relationships.includes(edge));
  }
});

test('taxonomy is acyclic, all concepts reachable exactly once, and future categories stay empty', () => {
  const placed = exploreCategories.flatMap((category) => [...category.concepts]);
  assert.equal(new Set(placed).size, placed.length);
  assert.deepEqual([...placed].sort(), Object.keys(concepts).sort());
  assert.equal(categoryConceptCount('all'), 32);
  assert.equal(childCategories('all').length, 9);
  for (const category of exploreCategories) {
    const path = categoryPath(category.id);
    assert.equal(path[0].id, 'all');
    assert.equal(path.at(-1)!.id, category.id);
    assert.equal(new Set(path.map((item) => item.id)).size, path.length);
    for (const id of category.concepts) assert.equal(conceptRegistry[id].categoryId, category.id);
  }
  for (const id of [
    'retrieval',
    'retrieval-embeddings',
    'vector-search',
    'rag',
    'document-context',
    'web',
  ] as const)
    assert.equal(categoryConceptCount(id), 0);
  assert.equal(conceptRegistry.embedding.categoryId, 'preparation');
});

test('reference projection reuses facts without rewriting Demo or carrying its navigation instructions', () => {
  const original = JSON.stringify(concepts);
  for (const concept of Object.values(conceptRegistry)) {
    const reference = exploreReference(concept.id)!;
    assert.ok(reference.explanation.length > 0);
    assert.ok(reference.deeper.length > 0);
  }
  assert.ok(concepts.device.description.includes('play the guided route below'));
  assert.ok(!exploreReference('device')!.explanation.includes('play the guided route below'));
  assert.ok(!exploreReference('tokenizer')!.deeper.includes('Try mixed-language text in Chat'));
  assert.equal(JSON.stringify(concepts), original);
  assert.equal(exploreReference('not-a-concept'), undefined);
});

test('Explore selection is a small independent context and connected/search destinations use canonical paths', () => {
  const initial = initialExploreState();
  const category = navigateExplore(initial, { categoryId: 'model' });
  const concept = navigateExplore(category, { conceptId: 'cache' });
  assert.deepEqual(initial, { categoryId: 'all', conceptId: null });
  assert.deepEqual(concept, { categoryId: 'kv-cache', conceptId: 'cache' });
  assert.deepEqual(
    categoryPath(concept.categoryId).map((item) => item.id),
    ['all', 'model', 'blocks', 'kv-cache'],
  );
  assert.deepEqual(navigateExplore(concept, { categoryId: 'blocks' }), {
    categoryId: 'blocks',
    conceptId: null,
  });
  assert.equal(navigateExplore(concept, { conceptId: 'missing' }), concept);
  assert.equal(navigateExplore(concept, { categoryId: 'missing' }), concept);
  assert.equal(searchConceptRegistry('KV cache')[0].id, 'cache');
  assert.ok(searchConceptRegistry('network').some((item) => item.id === 'router'));
  assert.deepEqual(searchConceptRegistry('no matching concept'), []);
});
