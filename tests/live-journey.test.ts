import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveJourney } from '../src/live-journey.ts';
import { LiveRequests } from '../src/live-request.ts';
import type { LiveRequestSnapshot } from '../src/live-request.ts';
import type { WorkspaceInstanceId } from '../src/workspace.ts';
import type { ProviderResult } from '../src/provider.ts';
import { GuidedSessions } from '../src/guided-session.ts';

const owner = {
  workspace: 'LIVE' as const,
  instanceId: 'live:text' as WorkspaceInstanceId,
  label: 'Live text',
};
const config = { url: 'https://example.test/v1', model: 'mock', key: '', stream: true, logprobs: false };
function setup() {
  let resolve!: (value: ProviderResult) => void;
  let data!: (text: string, event: string) => void;
  const requests = new LiveRequests({
    transport: async (_c, _m, _s, onData) => {
      data = onData;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const lesson = new LiveJourney();
  const accepted = requests.start(owner, { prompt: 'Weather documents tools', config });
  assert(accepted.accepted);
  lesson.receive(requests.current!);
  return {
    requests,
    lesson,
    accepted,
    resolve: (value: ProviderResult) => resolve(value),
    data: (text: string) => data(text, 'chunk'),
  };
}
test('initial trace is evidence-based with explicitly illustrative model, never keyword routes', () => {
  const { lesson, requests } = setup();
  assert.deepEqual(
    lesson.stages.map((s) => s.conceptId),
    ['device', 'context', 'device', 'block'],
  );
  assert.deepEqual(
    lesson.stages.map((s) => s.evidence.kind),
    ['OBSERVED', 'LOCALLY_CALCULATED', 'OBSERVED', 'ILLUSTRATIVE'],
  );
  requests.cancel(requests.current!.id);
});
test('incremental results annotate stable stages without resetting position/time or provenance', async () => {
  const { lesson, requests, data, resolve, accepted } = setup();
  lesson.restart();
  lesson.seek(1);
  lesson.tick(100);
  const original = lesson.current!.id;
  data('Hello');
  lesson.receive(requests.current!);
  const responseId = lesson.stages.at(-1)!.id;
  data('Hello world');
  lesson.receive(requests.current!);
  resolve({ text: 'Hello world', tokens: [], finishReason: 'stop' });
  lesson.receive(await accepted.completion);
  assert.equal(lesson.current!.id, original);
  assert.equal(lesson.elapsed, 100);
  assert.equal(lesson.stages.length, 5);
  assert.equal(lesson.stages.at(-1)!.id, responseId);
  assert.equal(lesson.stages[3].evidence.kind, 'ILLUSTRATIVE');
  assert.equal(lesson.control.completed, false);
});
test('completion retains terminal stage while request finishes; Replay includes new evidence without a request', async () => {
  const { lesson, requests, resolve, accepted } = setup();
  lesson.restart();
  lesson.seek(3);
  lesson.action({ type: 'COMPLETE' });
  const final = lesson.current;
  resolve({ text: 'Late result', tokens: [] });
  lesson.receive(await accepted.completion);
  assert.equal(lesson.current, final);
  assert.equal(lesson.stages.length, 4);
  assert(lesson.control.completed);
  const id = requests.current!.id;
  lesson.restart();
  assert.equal(lesson.stages.length, 5);
  assert.equal(lesson.position, 0);
  assert.equal(requests.current!.id, id);
});
test('Manual/Auto, detachment and suspension preserve accumulated time using inherited reducer', () => {
  const { lesson, requests } = setup();
  lesson.restart();
  lesson.tick(100);
  lesson.action({ type: 'SET_MODE', mode: 'MANUAL' });
  lesson.tick(100);
  assert.equal(lesson.elapsed, 100);
  lesson.action({ type: 'SET_MODE', mode: 'AUTO' });
  lesson.action({ type: 'DETACH' });
  lesson.tick(100);
  assert.equal(lesson.elapsed, 100);
  lesson.action({ type: 'RESUME' });
  lesson.tick(100);
  assert.equal(lesson.elapsed, 200);
  lesson.action({ type: 'SET_SUSPENSION', reason: 'READING_HOLD', suspended: true });
  lesson.tick(100);
  assert.equal(lesson.elapsed, 200);
  lesson.seek(1);
  assert.equal(lesson.elapsed, 0);
  requests.cancel(requests.current!.id);
});
test('cancel and End remain independent; a completed Live lesson frees admission while its request runs', () => {
  const { lesson, requests } = setup();
  const sessions = new GuidedSessions();
  sessions.register(owner, {
    incomplete: () => lesson.control.active && !lesson.control.completed,
    detach: () => lesson.action({ type: 'DETACH' }),
    resume: () => lesson.action({ type: 'RESUME' }),
    end: () => lesson.action({ type: 'STOP' }),
  });
  assert(sessions.admit(owner).allowed);
  lesson.restart();
  lesson.action({ type: 'COMPLETE' });
  sessions.reconcile(owner);
  assert.equal(sessions.current, undefined);
  assert.equal(requests.current!.state, 'RUNNING');
  lesson.restart();
  assert(sessions.admit(owner).allowed);
  sessions.end(sessions.current!.id);
  assert.equal(requests.current!.state, 'RUNNING');
  assert.equal(lesson.control.active, false);
  lesson.restart();
  requests.cancel(requests.current!.id);
  lesson.receive(requests.current!);
  assert.equal(lesson.control.active, true);
  assert.equal(lesson.control.completed, false);
});
test('immutable request notifications expose all transitions and unsubscribe cleanly', async () => {
  const { requests, resolve, accepted } = setup();
  const snapshots: LiveRequestSnapshot[] = [];
  const unsubscribe = requests.subscribe((s) => snapshots.push(s));
  await Promise.resolve();
  resolve({ text: 'Done', tokens: [] });
  await accepted.completion;
  await Promise.resolve();
  assert.deepEqual(
    [...new Set(snapshots.map((s) => s.state))],
    ['IDLE', 'PREPARING', 'RUNNING', 'COMPLETING', 'COMPLETED'],
  );
  assert(snapshots.every(Object.isFrozen));
  unsubscribe();
});
