import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJourneyControl, transitionJourney, journeyAdvancing } from '../src/core.ts';

test('initial replay is Auto and tracking, but does not advance until requested', () => {
  const ready = createJourneyControl();
  assert.equal(ready.journeyMode, 'AUTO');
  assert.equal(ready.guidedFocus, 'TRACKING');
  assert.equal(ready.active, false);
  assert.equal(transitionJourney(ready, { type: 'DETACH' }), ready);
  assert.equal(transitionJourney(ready, { type: 'RESUME' }), ready);
  assert.equal(journeyAdvancing(ready), false);
  const playing = transitionJourney(ready, { type: 'PLAY' });
  assert.equal(journeyAdvancing(playing), true);
  assert.equal(journeyAdvancing(transitionJourney(playing, { type: 'PAUSE' })), false);
  assert.equal(ready.playbackRequested, false);
});

test('starting and explicit navigation activate one journey; only restarting reattaches', () => {
  const manual = transitionJourney(createJourneyControl(), { type: 'SET_MODE', mode: 'MANUAL' });
  assert.equal(manual.active, false);
  const started = transitionJourney(manual, { type: 'START' });
  assert.equal(started.active, true);
  assert.equal(journeyAdvancing(started), false);
  const detached = transitionJourney(started, { type: 'DETACH' });
  assert.equal(transitionJourney(detached, { type: 'NAVIGATE' }).guidedFocus, 'DETACHED');
  assert.equal(transitionJourney(detached, { type: 'START' }).guidedFocus, 'TRACKING');
  assert.equal(transitionJourney(createJourneyControl(), { type: 'NAVIGATE' }).active, true);
});

test('Auto detachment suspends progression without destroying Auto intent', () => {
  const playing = transitionJourney(createJourneyControl(), { type: 'PLAY' });
  const detached = transitionJourney(playing, { type: 'DETACH' });
  assert.equal(detached.journeyMode, 'AUTO');
  assert.equal(detached.playbackRequested, true);
  assert.equal(journeyAdvancing(detached), false);
  assert.equal(journeyAdvancing(transitionJourney(detached, { type: 'PLAY' })), false);
  assert.equal(journeyAdvancing(transitionJourney(detached, { type: 'RESUME' })), true);
});

test('Manual never runs the timer, including Play and Resume after exploration', () => {
  let control = transitionJourney(createJourneyControl(), { type: 'SET_MODE', mode: 'MANUAL' });
  for (const type of ['PLAY', 'DETACH', 'PLAY', 'RESUME'] as const) {
    control = transitionJourney(control, { type });
    assert.equal(control.journeyMode, 'MANUAL');
    assert.equal(journeyAdvancing(control), false);
  }
  assert.equal(control.guidedFocus, 'TRACKING');
});

test('mode switches preserve attachment and only Auto tracking can advance', () => {
  for (const guidedFocus of ['TRACKING', 'DETACHED'] as const) {
    const initial = { ...createJourneyControl(), guidedFocus };
    const auto = transitionJourney(initial, { type: 'SET_MODE', mode: 'AUTO' });
    assert.equal(auto.guidedFocus, guidedFocus);
    assert.equal(journeyAdvancing(auto), guidedFocus === 'TRACKING');
    const manual = transitionJourney(auto, { type: 'SET_MODE', mode: 'MANUAL' });
    assert.equal(manual.guidedFocus, guidedFocus);
    assert.equal(journeyAdvancing(manual), false);
    const resumed = transitionJourney(manual, { type: 'RESUME' });
    assert.equal(resumed.journeyMode, 'MANUAL');
    assert.equal(resumed.guidedFocus, 'TRACKING');
  }
});
