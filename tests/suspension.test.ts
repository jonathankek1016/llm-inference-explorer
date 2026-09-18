import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJourneyControl,
  transitionJourney,
  journeyAdvancing,
  journeySuspended,
  advanceJourneyTime,
} from '../src/core.ts';

test('Settings round trips preserve all four canonical journey states and explicit pause', () => {
  const ready = createJourneyControl();
  const auto = transitionJourney(ready, { type: 'START' });
  const states = [
    auto,
    transitionJourney(auto, { type: 'DETACH' }),
    transitionJourney(auto, { type: 'SET_MODE', mode: 'MANUAL' }),
    ready,
    transitionJourney(ready, { type: 'SET_MODE', mode: 'MANUAL' }),
    transitionJourney(auto, { type: 'PAUSE' }),
  ];
  for (const before of states) {
    const opened = transitionJourney(before, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
    assert.equal(journeyAdvancing(opened), false);
    assert.deepEqual({ ...opened, suspensions: before.suspensions }, before);
    const closed = transitionJourney(opened, {
      type: 'SET_SUSPENSION',
      reason: 'SETTINGS',
      suspended: false,
    });
    assert.deepEqual(closed, before);
    assert.equal(journeyAdvancing(closed), journeyAdvancing(before));
  }
});

test('independent holds are idempotent and release only their own reason', () => {
  const auto = transitionJourney(createJourneyControl(), { type: 'START' });
  let held = transitionJourney(auto, { type: 'SET_SUSPENSION', reason: 'READING_HOLD', suspended: true });
  held = transitionJourney(held, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  held = transitionJourney(held, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  assert.equal(held.suspensions.length, 2);
  assert.equal(held.playbackRequested, true);
  assert.equal(held.guidedFocus, 'TRACKING');
  held = transitionJourney(held, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: false });
  assert.equal(journeyAdvancing(held), false);
  assert.equal(journeySuspended(held), true);
  for (const action of ['PAUSE', 'DETACH'] as const) {
    const blocked = transitionJourney(held, { type: action });
    const released = transitionJourney(blocked, {
      type: 'SET_SUSPENSION',
      reason: 'READING_HOLD',
      suspended: false,
    });
    assert.equal(journeySuspended(released), false);
    assert.equal(journeyAdvancing(released), false);
  }
  assert.equal(journeyAdvancing(transitionJourney(held, { type: 'RESUME' })), false);
  assert.equal(
    journeyAdvancing(
      transitionJourney(held, { type: 'SET_SUSPENSION', reason: 'READING_HOLD', suspended: false }),
    ),
    true,
  );
  assert.deepEqual(auto.suspensions, []);
});

test('choosing Auto while inactive does not start a journey, including after Settings closes', () => {
  let state = transitionJourney(createJourneyControl(), { type: 'SET_MODE', mode: 'MANUAL' });
  state = transitionJourney(state, { type: 'SET_MODE', mode: 'AUTO' });
  state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: false });
  assert.equal(state.active, false);
  assert.equal(journeyAdvancing(state), false);
  assert.equal(journeyAdvancing(transitionJourney(state, { type: 'START' })), true);
});

test('teaching time excludes suspended wall time and retains remaining duration and speed', () => {
  const auto = transitionJourney(createJourneyControl(), { type: 'START' });
  let elapsed = 0;
  for (let i = 0; i < 32; i++) elapsed = advanceJourneyTime(auto, elapsed, 100);
  assert.equal(elapsed, 3200);
  const held = transitionJourney(auto, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  elapsed = advanceJourneyTime(held, elapsed, 30000);
  assert.equal(elapsed, 3200);
  const resumed = transitionJourney(held, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: false });
  for (let i = 0; i < 47; i++) elapsed = advanceJourneyTime(resumed, elapsed, 100);
  assert.equal(elapsed, 7900);
  assert.equal(advanceJourneyTime(resumed, elapsed, 50, 2), 8000);
  assert.equal(advanceJourneyTime(resumed, elapsed, -10), elapsed);
});
