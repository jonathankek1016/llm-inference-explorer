import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveRequests } from '../src/live-request.ts';
import { GuidedSessions, isIncompleteJourney } from '../src/guided-session.ts';
import type { SessionOwner } from '../src/guided-session.ts';
import { createJourneyControl, transitionJourney } from '../src/core.ts';
import type { JourneyAction } from '../src/core.ts';
import type { WorkspaceInstanceId } from '../src/workspace.ts';
import type { ProviderResult, requestText } from '../src/provider.ts';

function fixture() {
  const sessions = new GuidedSessions();
  const owner: SessionOwner = {
    workspace: 'LIVE',
    instanceId: 'live:test' as WorkspaceInstanceId,
    label: 'Live test',
  };
  let journey = createJourneyControl();
  const update = (action: JourneyAction) => {
    journey = transitionJourney(journey, action);
    sessions.reconcile(owner);
  };
  sessions.register(owner, {
    incomplete: () => isIncompleteJourney(journey),
    detach: () => update({ type: 'DETACH' }),
    resume: () => update({ type: 'RESUME' }),
    end: () => update({ type: 'STOP' }),
  });
  let resolve!: (result: ProviderResult) => void, reject!: (error: Error) => void, signal!: AbortSignal;
  const transport: typeof requestText = async (_c, _m, s) => {
    signal = s;
    return new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
  };
  const requests = new LiveRequests({ transport });
  const started = requests.start(
    { workspace: 'LIVE', instanceId: owner.instanceId },
    {
      prompt: 'Hello',
      config: { url: 'https://example.test', model: 'test', key: '', stream: false, logprobs: false },
    },
  );
  assert.ok(started.accepted);
  return {
    sessions,
    owner,
    requests,
    started,
    update,
    get journey() {
      return journey;
    },
    get signal() {
      return signal;
    },
    resolve: (result: ProviderResult) => resolve(result),
    reject: (error: Error) => reject(error),
  };
}

for (const mode of ['MANUAL', 'AUTO'] as const)
  test(`${mode}: request outlives completion, workspace browsing and a subsequently admitted Demo session`, async () => {
    const f = fixture();
    assert.equal(f.sessions.current, undefined); // Execution alone acquires no guided slot.
    f.update({ type: 'SET_MODE', mode });
    f.sessions.admit(f.owner);
    f.update({ type: 'START' });
    const guidedId = f.sessions.current!.id;
    assert.notEqual(String(guidedId), String(f.started.requestId));
    const running = f.requests.current;
    f.update({ type: 'PAUSE' });
    for (const reason of ['SETTINGS', 'APPEARANCE', 'READING_HOLD'] as const)
      f.update({ type: 'SET_SUSPENSION', reason, suspended: true });
    f.sessions.browse({ workspace: 'EXPLORE' });
    assert.equal(f.journey.guidedFocus, 'DETACHED');
    assert.deepEqual(f.requests.current, running);
    assert.equal(f.signal.aborted, false);
    f.update({ type: 'COMPLETE' });
    assert.equal(f.journey.completed, true);
    assert.equal(f.sessions.current, undefined);
    assert.equal(f.requests.current?.state, 'RUNNING');
    const demo: SessionOwner = {
      workspace: 'DEMO',
      instanceId: 'demo:test' as WorkspaceInstanceId,
      label: 'Demo test',
    };
    let demoActive = true;
    f.sessions.register(demo, {
      incomplete: () => demoActive,
      detach: () => {},
      resume: () => {},
      end: () => {
        demoActive = false;
      },
    });
    assert.equal(f.sessions.admit(demo).allowed, true);
    f.sessions.browse(demo);
    f.resolve({ text: 'Late Live result', tokens: [] });
    const completed = await f.started.completion;
    assert.equal(completed.owner.workspace, 'LIVE');
    assert.equal(completed.owner.instanceId, f.owner.instanceId);
    assert.equal(f.sessions.current?.owner.workspace, 'DEMO');
    assert.equal(demoActive, true);
    assert.equal(f.journey.completed, true);
  });

test('global End ends education only; cancellation ends execution only', async () => {
  const f = fixture();
  f.sessions.admit(f.owner);
  f.update({ type: 'START' });
  f.sessions.end(f.sessions.current!.id);
  assert.equal(f.journey.active, false);
  assert.equal(f.sessions.current, undefined);
  assert.equal(f.requests.current?.state, 'RUNNING');
  assert.equal(f.signal.aborted, false);
  f.sessions.admit(f.owner);
  f.update({ type: 'START' });
  const journey = f.journey,
    reservation = f.sessions.current;
  f.requests.cancel(f.started.requestId);
  assert.equal((await f.started.completion).state, 'CANCELLED');
  assert.deepEqual(f.journey, journey);
  assert.deepEqual(f.sessions.current, reservation);
  f.resolve({ text: 'late cancelled response', tokens: [] });
});

for (const terminal of ['complete', 'fail'] as const)
  test(`request ${terminal} does not finish or release the educational journey`, async () => {
    const f = fixture();
    f.sessions.admit(f.owner);
    f.update({ type: 'START' });
    const journey = f.journey,
      reservation = f.sessions.current;
    if (terminal === 'complete') f.resolve({ text: 'Early response', tokens: [] });
    else f.reject(new Error('Transport failed'));
    assert.equal((await f.started.completion).state, terminal === 'complete' ? 'COMPLETED' : 'FAILED');
    assert.deepEqual(f.journey, journey);
    assert.deepEqual(f.sessions.current, reservation);
  });
