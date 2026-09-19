import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calloutPresentation, openCallout, placeCallout } from '../src/callouts.ts';
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
    assert.equal(guided[0].id, 'guided');
    assert.equal(guided[0].conceptId, trace[index].conceptId);
    assert.equal(guided[0].position, `${index + 1} / ${trace.length}`);
    assert.ok(guided[0].summary.length > 40);
    assert.equal(cards[1].conceptId, 'router');
  }
  const detached = transitionJourney(active, { type: 'DETACH' });
  const held = transitionJourney(detached, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  assert.deepEqual(
    calloutPresentation(held, trace[0], 0, trace.length, exploration),
    calloutPresentation(detached, trace[0], 0, trace.length, exploration),
  );
  assert.equal(calloutPresentation(inactive, trace[0], 0, trace.length, exploration)[0].role, 'exploratory');
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
