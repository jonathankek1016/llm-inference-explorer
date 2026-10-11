import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createExplorePresentation,
  exploreCategoryScene,
  exploreConceptScene,
  exploreRooms,
} from '../src/workspace-state.ts';
import { conceptRegistry } from '../src/concept-registry.ts';
import { observeSceneFrames } from '../src/scene-loop.ts';

test('Explore bookmarks and pins are instance-local, not global journey state', () => {
  const a = createExplorePresentation(),
    b = createExplorePresentation();
  a.pins.push({ conceptId: 'router', scene: 'world' });
  a.views.set('world', { position: [1, 2, 3], target: [0, 0, 0], zoom: 2, composition: [0, 0] });
  assert.equal(b.pins.length, 0);
  assert.equal(b.views.size, 0);
  assert.equal(b.selected, null);
});

test('coherent category rooms reuse authored anchors and leave future categories unmapped', () => {
  assert.equal(exploreCategoryScene('attention'), 'block');
  assert.equal(exploreCategoryScene('preparation'), 'model');
  assert.equal(exploreCategoryScene('network'), 'world');
  assert.equal(exploreCategoryScene('host'), 'tools');
  for (const category of ['retrieval', 'rag', 'web', 'vector-search'] as const)
    assert.equal(exploreCategoryScene(category), undefined);
  for (const concept of Object.values(conceptRegistry)) {
    assert.equal(exploreConceptScene(concept.id), concept.anchor.scene);
    assert.ok(exploreRooms.some((room) => room.scene === exploreConceptScene(concept.id)));
  }
  assert.equal(exploreConceptScene('future-unknown'), undefined);
});

test('retained renderers share one scheduler and disposal removes every callback and RAF', () => {
  const pending = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  const originalRequest = globalThis.requestAnimationFrame,
    originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    pending.set(++sequence, cb);
    return sequence;
  };
  globalThis.cancelAnimationFrame = (id) => {
    pending.delete(id);
  };
  const seen: string[] = [];
  const first = observeSceneFrames(() => seen.push('demo'));
  const second = observeSceneFrames(() => seen.push('explore'));
  try {
    assert.equal(pending.size, 1);
    const tick = [...pending.values()][0];
    pending.clear();
    tick(10);
    assert.deepEqual(seen, ['demo', 'explore']);
    assert.equal(pending.size, 1);
    second();
    seen.length = 0;
    const next = [...pending.values()][0];
    pending.clear();
    next(20);
    assert.deepEqual(seen, ['demo']);
    first();
    assert.equal(pending.size, 0);
  } finally {
    first();
    second();
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});
