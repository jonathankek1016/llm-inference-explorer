import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GuidedSessions, isIncompleteJourney } from '../src/guided-session.ts';
import type { SessionOwner } from '../src/guided-session.ts';
import type { WorkspaceInstanceId } from '../src/workspace.ts';
import { createJourneyControl, transitionJourney, advanceJourneyTime } from '../src/core.ts';

function lab(manager: GuidedSessions, workspace: 'DEMO' | 'LIVE', name: string) {
  const owner: SessionOwner = { workspace, instanceId: name as WorkspaceInstanceId, label: name };
  let journey = createJourneyControl();
  let resumes = 0,
    ends = 0;
  const update = (action: Parameters<typeof transitionJourney>[1]) => {
    journey = transitionJourney(journey, action);
    manager.reconcile(owner);
  };
  manager.register(owner, {
    incomplete: () => isIncompleteJourney(journey),
    detach: () => update({ type: 'DETACH' }),
    resume: () => {
      resumes++;
      update({ type: 'RESUME' });
    },
    end: () => {
      ends++;
      update({ type: 'STOP' });
    },
  });
  return {
    owner,
    update,
    get journey() {
      return journey;
    },
    get resumes() {
      return resumes;
    },
    get ends() {
      return ends;
    },
  };
}

test('one incomplete reservation survives modes, pause, detachment and composable blockers', () => {
  for (const mode of ['AUTO', 'MANUAL'] as const) {
    const manager = new GuidedSessions();
    const demo = lab(manager, 'DEMO', 'demo');
    assert.equal(manager.current, undefined);
    demo.update({ type: 'SET_MODE', mode });
    const admitted = manager.admit(demo.owner);
    demo.update({ type: 'START' });
    const id = manager.current!.id;
    assert.equal(admitted.allowed, true);
    for (const reason of ['SETTINGS', 'APPEARANCE', 'READING_HOLD'] as const) {
      demo.update({ type: 'SET_SUSPENSION', reason, suspended: true });
      assert.equal(manager.current!.id, id);
    }
    demo.update({ type: 'PAUSE' });
    const before = demo.journey;
    manager.browse({ workspace: 'EXPLORE' });
    assert.deepEqual(demo.journey, { ...before, guidedFocus: 'DETACHED' });
    assert.equal(manager.current!.id, id);
    manager.browse(demo.owner);
    assert.equal(demo.journey.guidedFocus, 'DETACHED');
    let returned = false;
    manager.returnTo(id, (destination) => {
      assert.deepEqual(destination, demo.owner);
      returned = true;
    });
    assert.equal(returned, true);
    assert.equal(demo.journey.guidedFocus, 'TRACKING');
    assert.equal(demo.journey.playbackRequested, false);
    assert.deepEqual(demo.journey.suspensions, before.suspensions);
  }
});

test('cross-workspace browsing freezes remaining Auto time without changing intent or local clock', () => {
  const manager = new GuidedSessions();
  const demo = lab(manager, 'DEMO', 'demo');
  manager.admit(demo.owner);
  demo.update({ type: 'START' });
  const elapsed = 3000;
  manager.browse({ workspace: 'EXPLORE' });
  assert.equal(demo.journey.playbackRequested, true);
  assert.equal(advanceJourneyTime(demo.journey, elapsed, 100), elapsed);
  manager.returnTo(manager.current!.id, () => {});
  assert.equal(advanceJourneyTime(demo.journey, elapsed, 100), elapsed + 100);
});

test('completion frees global slot while retaining local presentation; replay gets a new identity', () => {
  const manager = new GuidedSessions();
  const demo = lab(manager, 'DEMO', 'demo');
  const live = lab(manager, 'LIVE', 'live');
  manager.admit(demo.owner);
  demo.update({ type: 'START' });
  const previous = manager.current!.id;
  demo.update({ type: 'COMPLETE' });
  assert.equal(manager.current, undefined);
  assert.equal(demo.journey.active, true);
  assert.equal(demo.journey.completed, true);
  assert.equal(manager.admit(live.owner).allowed, true);
  live.update({ type: 'START' });
  const active = manager.current;
  assert.deepEqual(manager.admit(demo.owner, true), { allowed: false, reservation: active });
  assert.equal(demo.journey.completed, true);
  assert.equal(live.ends, 0);
  manager.end(active!.id);
  assert.equal(manager.current, undefined);
  assert.equal(live.journey.active, false);
  assert.equal(demo.journey.completed, true);
  manager.admit(demo.owner, true);
  demo.update({ type: 'START' });
  assert.notEqual(manager.current!.id, previous);
  manager.end(previous);
  assert.equal(demo.journey.active, true);
});

test('different labs in the same root conflict; returning and ending target only the owner', () => {
  const manager = new GuidedSessions();
  const a = lab(manager, 'DEMO', 'a');
  const b = lab(manager, 'DEMO', 'b');
  manager.admit(a.owner);
  a.update({ type: 'START' });
  const reserved = manager.current!;
  assert.equal(manager.admit(b.owner).allowed, false);
  assert.equal(b.journey.active, false);
  manager.browse(b.owner);
  assert.equal(a.journey.guidedFocus, 'DETACHED');
  manager.returnTo(reserved.id, () => {});
  assert.equal(a.resumes, 1);
  assert.equal(b.resumes, 0);
  manager.end(reserved.id);
  assert.equal(a.ends, 1);
  assert.equal(b.ends, 0);
  assert.equal(manager.current, undefined);
});
