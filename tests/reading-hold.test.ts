import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadingHold, readingIdleMs } from '../src/reading-hold.ts';
import {
  createJourneyControl,
  transitionJourney,
  advanceJourneyTime,
  journeyAdvancing,
} from '../src/core.ts';

function fixture() {
  const context = {
    journey: transitionJourney(createJourneyControl(), { type: 'START' }),
    stage: 'text-0',
    subject: 'device',
    selection: 'device',
    inspectorVisible: true,
  };
  const hold = new ReadingHold((suspended) => {
    context.journey = transitionJourney(context.journey, {
      type: 'SET_SUSPENSION',
      reason: 'READING_HOLD',
      suspended,
    });
  });
  return { context, hold };
}
test('reading pauses only educational elapsed time and releases the remaining duration without derailment', () => {
  const { context, hold } = fixture();
  let elapsed = 1200;
  hold.activity('inspector', context, 0);
  assert.equal(context.journey.guidedFocus, 'TRACKING');
  assert.equal(context.journey.playbackRequested, true);
  elapsed = advanceJourneyTime(context.journey, elapsed, 100);
  assert.equal(elapsed, 1200);
  hold.activity('inspector', context, 3000);
  hold.sync(context, readingIdleMs);
  assert.equal(journeyAdvancing(context.journey), false);
  hold.sync(context, 3000 + readingIdleMs);
  assert.equal(advanceJourneyTime(context.journey, elapsed, 100), 1300);
});
test('Settings, explicit pause and detachment remain independent of reading leases', () => {
  for (const action of [
    { type: 'SET_SUSPENSION', reason: 'SETTINGS', suspended: true },
    { type: 'PAUSE' },
    { type: 'DETACH' },
  ] as const) {
    const { context, hold } = fixture();
    hold.activity('inspector', context, 0);
    context.journey = transitionJourney(context.journey, action);
    hold.sync(context, readingIdleMs);
    assert.equal(context.journey.suspensions.includes('READING_HOLD'), false);
    assert.equal(journeyAdvancing(context.journey), false);
    if (action.type === 'DETACH') assert.equal(context.journey.guidedFocus, 'DETACHED');
  }
  const { context, hold } = fixture();
  hold.activity('inspector', context, 0);
  context.journey = transitionJourney(context.journey, {
    type: 'SET_SUSPENSION',
    reason: 'SETTINGS',
    suspended: true,
  });
  context.journey = transitionJourney(context.journey, {
    type: 'SET_SUSPENSION',
    reason: 'SETTINGS',
    suspended: false,
  });
  assert.deepEqual(context.journey.suspensions, ['READING_HOLD']);
  assert.equal(journeyAdvancing(context.journey), false);
});
test('stage changes, closure and selection re-evaluate holds; two reading surfaces compose', () => {
  const { context, hold } = fixture();
  hold.activity('inspector', context, 0);
  hold.activity('callout', context, 1000);
  context.inspectorVisible = false;
  hold.sync(context, 2000);
  assert.deepEqual(context.journey.suspensions, ['READING_HOLD']);
  context.stage = 'text-1';
  hold.sync(context, 2001);
  assert.deepEqual(context.journey.suspensions, []);
  context.inspectorVisible = true;
  context.selection = 'router';
  hold.activity('inspector', context, 2100);
  assert.deepEqual(context.journey.suspensions, []);
});
test('inactive, Manual and detached interactions never introduce guided reading suspension', () => {
  for (const kind of ['inactive', 'manual', 'detached']) {
    const { context, hold } = fixture();
    if (kind === 'inactive') context.journey = createJourneyControl();
    else
      context.journey = transitionJourney(
        context.journey,
        kind === 'manual' ? { type: 'SET_MODE', mode: 'MANUAL' } : { type: 'DETACH' },
      );
    const before = structuredClone(context.journey);
    hold.activity('inspector', context, 0);
    hold.activity('callout', context, 0);
    hold.sync(context, 10000);
    assert.deepEqual(context.journey, before);
  }
});
