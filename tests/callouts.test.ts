import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calloutPresentation, openCallout, placeCallout, relieveCalloutCrowding } from '../src/callouts.ts';
import { concepts } from '../src/content.ts';
import { createJourneyControl, transitionJourney, makeTrace } from '../src/core.ts';

test('the guided card is derived only from the active official frame, not exploration', () => {
  const trace = makeTrace('text');
  const inactive = createJourneyControl();
  const active = transitionJourney(inactive, { type: 'START' });
  const exploration = openCallout([], 'router', 'world');
  assert.equal(calloutPresentation(inactive, trace[0], 0, trace.length, []).length, 0);
  for (const index of [0, 1, 2, 1, 0]) {
    const cards = calloutPresentation(active, trace[index], index, trace.length, exploration);
    const guided = cards.filter((card) => card.role === 'guided');
    assert.equal(guided.length, 1);
    assert.equal(guided[0].id, index === 1 ? 'explore-router' : 'guided');
    assert.equal(guided[0].conceptId, trace[index].conceptId);
    assert.equal(guided[0].position, `${index + 1} / ${trace.length}`);
    assert.ok(guided[0].summary.length > 40);
    assert.equal(cards.filter((card) => card.conceptId === 'router').length, 1);
    assert.equal(cards.length, index === 1 ? 1 : 2);
  }
  const detached = transitionJourney(active, { type: 'DETACH' });
  const held = transitionJourney(detached, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  assert.deepEqual(
    calloutPresentation(held, trace[0], 0, trace.length, exploration),
    calloutPresentation(detached, trace[0], 0, trace.length, exploration),
  );
  assert.equal(calloutPresentation(inactive, trace[0], 0, trace.length, exploration)[0].role, 'exploratory');
});

test('pinned cards hand off presentation without consuming pins, view memory or unrelated references', () => {
  const trace = makeTrace('text');
  const active = transitionJourney(createJourneyControl(), { type: 'START' });
  const pins = openCallout(openCallout([], 'router', 'world'), 'cache', 'block');
  const snapshot = structuredClone(pins);
  const present = (index: number, journey = active) =>
    calloutPresentation(journey, trace[index], index, trace.length, pins);
  const before = present(0);
  const during = present(1);
  assert.equal(during[0].id, before[1].id);
  assert.equal(during[0].role, 'guided');
  assert.equal(during[0].position, '2 / 18');
  assert.notEqual(during[0].summary, before[1].summary);
  assert.deepEqual(during[1], before[2]);
  assert.deepEqual(present(2)[1], before[1]);
  const stopped = present(1, transitionJourney(active, { type: 'STOP' }));
  assert.deepEqual(stopped, before.slice(1));
  const cacheIndex = trace.findIndex((event) => event.conceptId === 'cache');
  assert.equal(present(cacheIndex)[0].scene, 'model');
  assert.equal(present(cacheIndex + 1).find((card) => card.conceptId === 'cache')!.scene, 'block');
  assert.deepEqual(pins, snapshot);
});

test('repeated official subjects update one pinned guided card and guided-only cards stay ephemeral', () => {
  const trace = makeTrace('text');
  const journey = transitionJourney(createJourneyControl(), { type: 'START' });
  const pins = openCallout([], 'decode', 'model');
  for (const [index, event] of trace.entries()) {
    const cards = calloutPresentation(journey, event, index, trace.length, pins);
    assert.equal(new Set(cards.map((card) => card.conceptId)).size, cards.length);
    if (event.conceptId === 'decode') {
      assert.equal(cards.length, 1);
      assert.equal(cards[0].id, 'explore-decode');
      assert.equal(cards[0].detail, `Pass ${event.payload.decode}`);
    } else assert.equal(cards[0].id, 'guided');
  }
  assert.equal(
    calloutPresentation(transitionJourney(journey, { type: 'STOP' }), trace[0], 0, 18, []).length,
    0,
  );
  assert.equal(calloutPresentation(journey, trace[0], 0, 18, [])[0].title, concepts.device.title);
});

test('exploratory identity deduplicates and raises one concept without clearing others or their views', () => {
  const initial = openCallout([], 'device', 'world');
  const two = openCallout(initial, 'cache', 'model');
  const reopened = openCallout(two, 'device', 'compute');
  assert.deepEqual(reopened, [
    { conceptId: 'cache', scene: 'model' },
    { conceptId: 'device', scene: 'compute' },
  ]);
  assert.deepEqual(initial, [{ conceptId: 'device', scene: 'world' }]);
  assert.deepEqual(openCallout(reopened, 'missing', 'world'), reopened);
});

test('placement preserves association and clamps readable cards without changing world coordinates', () => {
  const bounds = { left: 300, right: 1100, top: 180, bottom: 780 };
  assert.deepEqual(placeCallout({ x: 500, y: 400, visible: true }, 240, 180, bounds), { x: 528, y: 196 });
  assert.deepEqual(placeCallout({ x: 1000, y: 700, visible: true }, 240, 180, bounds), { x: 732, y: 496 });
  assert.deepEqual(placeCallout(undefined, 240, 180, bounds), { x: 860, y: 180 });
  assert.deepEqual(placeCallout({ x: 500, y: 400, visible: true }, 240, 180, bounds, true), {
    x: 528,
    y: 424,
  });
});

test('crowding improves nearby collisions deterministically without repacking older cards', () => {
  const bounds = { left: 100, right: 1200, top: 80, bottom: 900 };
  const anchor = { x: 400, y: 700, visible: true };
  const first = { x: 428, y: 376, width: 240, height: 200 };
  const base = { ...placeCallout(anchor, 240, 200, bounds), width: 240, height: 200 };
  assert.deepEqual(relieveCalloutCrowding(first, anchor, bounds, []), first);
  const shifted = relieveCalloutCrowding(base, anchor, bounds, [first]);
  const overlap = (rect: typeof base) =>
    Math.max(0, Math.min(rect.x + rect.width, first.x + first.width) - Math.max(rect.x, first.x)) *
    Math.max(0, Math.min(rect.y + rect.height, first.y + first.height) - Math.max(rect.y, first.y));
  assert.ok(overlap(shifted) < overlap(base));
  assert.deepEqual(shifted, relieveCalloutCrowding(base, anchor, bounds, [first]));
  assert.ok(Math.hypot(shifted.x - base.x, shifted.y - base.y) <= 96);
  assert.ok(shifted.x >= anchor.x + 28);
  assert.ok(shifted.y + shifted.height <= anchor.y - 24);
  const third = relieveCalloutCrowding(base, anchor, bounds, [first, shifted]);
  assert.deepEqual(shifted, relieveCalloutCrowding(base, anchor, bounds, [first]));
  assert.ok(third.x >= bounds.left && third.x + third.width <= bounds.right);
  assert.ok(third.y >= bounds.top && third.y + third.height <= bounds.bottom);
});

test('crowding preserves preferred sides and viewport bounds even when a cluster cannot fit', () => {
  const bounds = { left: 300, right: 1100, top: 180, bottom: 780 };
  const anchor = { x: 700, y: 550, visible: true };
  for (const region of ['auto', 'upper-left', 'upper-right', 'left', 'right', 'above', 'below'] as const) {
    const base = { ...placeCallout(anchor, 200, 140, bounds, false, region), width: 200, height: 140 };
    const result = relieveCalloutCrowding(base, anchor, bounds, [base, base, base]);
    assert.ok(Math.hypot(result.x - base.x, result.y - base.y) <= 96);
    assert.ok(result.x >= bounds.left && result.x + result.width <= bounds.right);
    assert.ok(result.y >= bounds.top && result.y + result.height <= bounds.bottom);
    if (region.includes('left')) assert.ok(result.x + result.width <= anchor.x - 28);
    if (region.includes('right')) assert.ok(result.x >= anchor.x + 28);
    if (region === 'above') assert.ok(result.y + result.height <= anchor.y - 24);
    if (region === 'below') assert.ok(result.y >= anchor.y + 24);
  }
});
