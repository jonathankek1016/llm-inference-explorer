import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigationFocus, readNavigationPreferences } from '../src/navigation.ts';
import { createJourneyControl, transitionJourney, journeyAdvancing } from '../src/core.ts';
import { ReadingHold } from '../src/reading-hold.ts';

test('row policies are asymmetric, independent and validated at the storage boundary', () => {
  const defaults = { past: 'compare', future: 'guided' } as const;
  for (const value of [null, false, [], 'bad', { past: 'bad', future: 2 }])
    assert.deepEqual(readNavigationPreferences(value), defaults);
  for (const past of ['compare', 'guided'] as const)
    for (const future of ['compare', 'guided'] as const)
      for (const current of ['TRACKING', 'DETACHED'] as const) {
        const prefs = readNavigationPreferences({ past, future });
        assert.equal(
          navigationFocus({ kind: 'row', from: 5, to: 2 }, current, prefs),
          past === 'guided' ? 'TRACKING' : 'DETACHED',
        );
        assert.equal(
          navigationFocus({ kind: 'row', from: 2, to: 5 }, current, prefs),
          future === 'guided' ? 'TRACKING' : 'DETACHED',
        );
        assert.equal(navigationFocus({ kind: 'row', from: 2, to: 2 }, current, prefs), current);
        assert.equal(navigationFocus({ kind: 'step' }, current, prefs), current);
      }
});

test('exploration of current subject preserves attachment; another subject or scene detaches', () => {
  const prefs = readNavigationPreferences(null);
  for (const current of ['TRACKING', 'DETACHED'] as const) {
    assert.equal(
      navigationFocus({ kind: 'concept', subject: 'gpu', destination: 'gpu' }, current, prefs),
      current,
    );
    assert.equal(
      navigationFocus({ kind: 'concept', subject: 'gpu', destination: 'cache' }, current, prefs),
      'DETACHED',
    );
    assert.equal(navigationFocus({ kind: 'scene' }, current, prefs), 'DETACHED');
  }
});

test('row attachment policy preserves mode, playback intent and independent suspensions', () => {
  for (const mode of ['MANUAL', 'AUTO'] as const)
    for (const paused of [false, true]) {
      let state = transitionJourney(createJourneyControl(), { type: 'SET_MODE', mode });
      state = transitionJourney(state, { type: 'START' });
      if (paused) state = transitionJourney(state, { type: 'PAUSE' });
      state = transitionJourney(state, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
      const intent = state.playbackRequested;
      for (const guidedFocus of ['DETACHED', 'TRACKING'] as const) {
        state = transitionJourney(state, { type: 'NAVIGATE', guidedFocus });
        assert.equal(state.journeyMode, mode);
        assert.equal(state.playbackRequested, intent);
        assert.deepEqual(state.suspensions, ['SETTINGS']);
        assert.equal(journeyAdvancing(state), false);
      }
    }
});

test('restart can clear a same-stage reading lease without removing Settings or explicit pause', () => {
  let journey = transitionJourney(createJourneyControl(), { type: 'START' });
  const hold = new ReadingHold((suspended) => {
    journey = transitionJourney(journey, { type: 'SET_SUSPENSION', reason: 'READING_HOLD', suspended });
  });
  hold.activity(
    'callout',
    { journey, stage: 'text-0', subject: 'device', selection: 'device', inspectorVisible: true },
    0,
  );
  journey = transitionJourney(journey, { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true });
  journey = transitionJourney(journey, { type: 'PAUSE' });
  hold.clear();
  assert.deepEqual(journey.suspensions, ['SETTINGS']);
  assert.equal(journey.playbackRequested, false);
  assert.equal(hold.has('callout'), false);
});
