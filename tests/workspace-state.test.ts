import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExplorePresentation } from '../src/workspace-state.ts';
import { categoryGallery, conceptGallery, exploreGalleries } from '../src/explore-catalogue.ts';
import { conceptRegistry } from '../src/concept-registry.ts';
import { observeSceneFrames } from '../src/scene-loop.ts';

test('Explore bookmarks and pins are instance-local, not global journey state', () => {
  const a = createExplorePresentation(),
    b = createExplorePresentation();
  a.pins.push({ conceptId: 'router', scene: 'catalogue:network' });
  a.views.set('catalogue:network', { position: [1, 2, 3], target: [0, 0, 0], zoom: 2, composition: [0, 0] });
  assert.equal(b.pins.length, 0);
  assert.equal(b.views.size, 0);
  assert.equal(b.selected, null);
});

test('category galleries cover shared concepts without Demo scene or stage identities', () => {
  assert.equal(categoryGallery('attention')?.categoryId, 'blocks');
  assert.equal(categoryGallery('preparation')?.categoryId, 'preparation');
  assert.equal(categoryGallery('network')?.categoryId, 'network');
  assert.equal(categoryGallery('host')?.categoryId, 'tools');
  for (const category of ['retrieval', 'rag', 'web', 'vector-search'] as const)
    assert.equal(categoryGallery(category), undefined);
  for (const concept of Object.values(conceptRegistry)) {
    assert.ok(conceptGallery(concept.id)?.exhibits.some((e) => e.conceptId === concept.id));
  }
  assert.equal(conceptGallery('future-unknown'), undefined);
  assert.equal(new Set(exploreGalleries.map((g) => g.id)).size, exploreGalleries.length);
  for (const gallery of exploreGalleries) {
    assert.ok(gallery.id.startsWith('catalogue:'));
    assert.equal(new Set(gallery.exhibits.map((e) => e.conceptId)).size, gallery.exhibits.length);
    assert.equal(new Set(gallery.exhibits.map((e) => e.position.join(','))).size, gallery.exhibits.length);
    for (const exhibit of gallery.exhibits) assert.ok(conceptRegistry[exhibit.conceptId]);
    assert.ok(gallery.framing.span > 0);
  }
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
