import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSwitchWorkspace, demoCompatibilityHost, workspaces } from '../src/workspace.ts';
import { createJourneyControl, transitionJourney } from '../src/core.ts';

test('root identity defaults to the Demo compatibility host, independently of journey mode', () => {
  assert.equal(demoCompatibilityHost.workspace, 'DEMO');
  assert.deepEqual(
    workspaces.map((w) => w.id),
    ['EXPLORE', 'DEMO', 'LIVE'],
  );
  assert.equal(typeof demoCompatibilityHost.instanceId, 'string');
});

test('temporary guard blocks every incomplete Demo journey without changing any state', () => {
  for (const mode of ['MANUAL', 'AUTO'] as const)
    for (const detached of [false, true])
      for (const paused of [false, true]) {
        let journey = transitionJourney(createJourneyControl(), { type: 'SET_MODE', mode });
        journey = transitionJourney(journey, { type: 'START' });
        if (detached) journey = transitionJourney(journey, { type: 'DETACH' });
        if (paused) journey = transitionJourney(journey, { type: 'PAUSE' });
        for (const reason of ['READING_HOLD', 'SETTINGS', 'APPEARANCE'] as const) {
          journey = transitionJourney(journey, { type: 'SET_SUSPENSION', reason, suspended: true });
          const before = structuredClone(journey);
          assert.equal(canSwitchWorkspace('DEMO', 'EXPLORE', journey), false);
          assert.equal(canSwitchWorkspace('DEMO', 'LIVE', journey), false);
          assert.equal(canSwitchWorkspace('DEMO', 'DEMO', journey), true);
          assert.deepEqual(journey, before);
        }
      }
});

test('inactive and retained completed states allow navigation without releasing completion', () => {
  const inactive = createJourneyControl();
  const completed = transitionJourney(transitionJourney(inactive, { type: 'START' }), { type: 'COMPLETE' });
  for (const journey of [inactive, completed])
    for (const from of workspaces)
      for (const to of workspaces) assert.equal(canSwitchWorkspace(from.id, to.id, journey), true);
  assert.equal(completed.active, true);
  assert.equal(completed.completed, true);
});
