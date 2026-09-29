import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJourneyControl,
  transitionJourney,
  journeyAdvancing,
  journeyStatus,
  advanceJourneyTime,
  journeyFlowActive,
  journeyFlowSuspended,
  makeTrace,
} from '../src/core.ts';
import { teachingDuration, framingStageKey } from '../src/framing.ts';
import { scenarios } from '../src/content.ts';

test('completion preserves guided ownership and mode until navigation/restart; Stop stays distinct', () => {
  for (const mode of ['MANUAL', 'AUTO'] as const) {
    let state = transitionJourney(createJourneyControl(), { type: 'SET_MODE', mode });
    assert.equal(transitionJourney(state, { type: 'COMPLETE' }), state);
    state = transitionJourney(state, { type: 'START' });
    const complete = transitionJourney(state, { type: 'COMPLETE' });
    assert.equal(complete.active, true);
    assert.equal(complete.guidedFocus, 'TRACKING');
    assert.equal(complete.journeyMode, mode);
    assert.equal(journeyStatus(complete), 'Journey complete');
    assert.equal(journeyAdvancing(complete), false);
    assert.equal(journeyFlowActive(complete), false);
    assert.equal(transitionJourney(complete, { type: 'PLAY' }), complete);
    assert.equal(journeyAdvancing(transitionJourney(complete, { type: 'SET_MODE', mode: 'AUTO' })), false);
    assert.equal(transitionJourney(complete, { type: 'NAVIGATE' }).completed, false);
    const restarted = transitionJourney(complete, { type: 'START' });
    assert.equal(restarted.completed, false);
    assert.equal(restarted.playbackRequested, mode === 'AUTO');
    const stopped = transitionJourney(state, { type: 'STOP' });
    assert.equal(stopped.completed, false);
    assert.equal(journeyStatus(stopped), 'Free exploration');
  }
});

test('same-stage mode changes freeze and resume elapsed time, including repeated detached toggles', () => {
  let state = transitionJourney(createJourneyControl(), { type: 'START' });
  let elapsed = 6000;
  for (const focus of ['TRACKING', 'DETACHED'] as const) {
    state = transitionJourney(state, { type: focus === 'TRACKING' ? 'RESUME' : 'DETACH' });
    for (let i = 0; i < 3; i++) {
      state = transitionJourney(state, { type: 'SET_MODE', mode: 'MANUAL' });
      elapsed = advanceJourneyTime(state, elapsed, 30000);
      assert.equal(elapsed, 6000);
      state = transitionJourney(state, { type: 'SET_MODE', mode: 'AUTO' });
      assert.equal(state.guidedFocus, focus);
      assert.equal(state.playbackRequested, true);
      assert.equal(advanceJourneyTime(state, elapsed, 100), focus === 'TRACKING' ? 6100 : 6000);
    }
  }
});

test('flow follows active incomplete ownership; only modal reasons freeze it', () => {
  const inactive = createJourneyControl();
  assert.equal(journeyFlowActive(inactive), false);
  for (const mode of ['MANUAL', 'AUTO'] as const) {
    let state = transitionJourney(transitionJourney(inactive, { type: 'SET_MODE', mode }), { type: 'START' });
    for (const type of ['PAUSE', 'DETACH'] as const) {
      state = transitionJourney(state, { type });
      assert.equal(journeyFlowActive(state), true);
      assert.equal(journeyFlowSuspended(state), false);
    }
    state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'READING_HOLD', suspended: true });
    assert.equal(journeyFlowSuspended(state), false);
    for (const reason of ['SETTINGS', 'APPEARANCE'] as const)
      state = transitionJourney(state, { type: 'SET_SUSPENSION', reason, suspended: true });
    state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: false });
    assert.equal(journeyFlowSuspended(state), true);
    state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'APPEARANCE', suspended: false });
    assert.equal(journeyFlowActive(state), true);
    assert.equal(journeyFlowSuspended(state), false);
    assert.equal(journeyAdvancing(state), false);
    assert.equal(journeyFlowActive(transitionJourney(state, { type: 'STOP' })), false);
  }
});

test('every scenario and route uses authored teaching pace, with longer conceptual transformations', () => {
  for (const scenario of Object.keys(scenarios))
    for (const local of [false, true]) {
      const trace = makeTrace(scenario, local);
      const durations = trace.map((event) => teachingDuration(event, local));
      assert.ok(new Set(durations).size >= 2);
      assert.ok(durations.every((ms) => ms >= 5000 && ms <= 10000));
      const gpu = trace.find((event) => event.conceptId === 'gpu')!;
      assert.ok(teachingDuration(gpu, local) > durations[0]);
    }
  const trace = makeTrace('text');
  const block = trace.find((event) => event.conceptId === 'block')!;
  assert.equal(teachingDuration(block, false), 10000);
  assert.equal(
    teachingDuration(block, false, {
      stages: { [framingStageKey(block, false)]: { teachingDurationMs: 12300 } },
    }),
    12300,
  );
  // Invalid authored timing still uses the original trace fallback.
  assert.equal(
    teachingDuration(block, false, {
      stages: { [framingStageKey(block, false)]: { teachingDurationMs: NaN } },
    }),
    block.duration,
  );
});

test('Resume restores attachment without erasing explicit pause or independent holds', () => {
  let state = transitionJourney(createJourneyControl(), { type: 'START' });
  state = transitionJourney(state, { type: 'PAUSE' });
  state = transitionJourney(state, { type: 'DETACH' });
  for (const reason of ['SETTINGS', 'READING_HOLD'] as const)
    state = transitionJourney(state, { type: 'SET_SUSPENSION', reason, suspended: true });
  state = transitionJourney(state, { type: 'RESUME' });
  assert.equal(state.guidedFocus, 'TRACKING');
  assert.equal(state.playbackRequested, false);
  for (const reason of ['SETTINGS', 'READING_HOLD'] as const) {
    state = transitionJourney(state, { type: 'SET_SUSPENSION', reason, suspended: false });
    assert.equal(journeyAdvancing(state), false);
  }
  state = transitionJourney(state, { type: 'PLAY' });
  assert.equal(journeyAdvancing(state), true);
});

test('Stop leaves a reusable free-exploration state without clearing preferences or modal ownership', () => {
  for (const mode of ['MANUAL', 'AUTO'] as const) {
    let state = transitionJourney(createJourneyControl(), { type: 'SET_MODE', mode });
    state = transitionJourney(state, { type: 'START' });
    state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
    state = transitionJourney(state, { type: 'DETACH' });
    state = transitionJourney(state, { type: 'STOP' });
    assert.equal(state.active, false);
    assert.equal(state.playbackRequested, false);
    assert.equal(state.journeyMode, mode);
    assert.deepEqual(state.suspensions, ['SETTINGS']);
    assert.equal(journeyStatus(state), 'Free exploration');
    assert.equal(advanceJourneyTime(state, 1200, 100), 1200);
    state = transitionJourney(state, { type: 'START' });
    assert.equal(state.active, true);
    assert.equal(state.playbackRequested, mode === 'AUTO');
    assert.equal(journeyAdvancing(state), false);
  }
});

test('status distinguishes playback intent from simultaneous temporary blockers; speed scales only elapsed time', () => {
  let state = transitionJourney(createJourneyControl(), { type: 'START' });
  assert.equal(journeyStatus(state), 'Auto playing · Guided');
  assert.equal(advanceJourneyTime(state, 1000, 100, 0.5), 1050);
  assert.equal(advanceJourneyTime(state, 1000, 100, 2), 1200);
  state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'READING_HOLD', suspended: true });
  assert.equal(journeyStatus(state), 'Auto held · Reading');
  state = transitionJourney(state, { type: 'PAUSE' });
  state = transitionJourney(state, { type: 'DETACH' });
  state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  assert.match(journeyStatus(state), /Auto paused.*Exploring.*Settings open.*Reading/);
  assert.equal(advanceJourneyTime(state, 1000, 100, 2), 1000);
});
