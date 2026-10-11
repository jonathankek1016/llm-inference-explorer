import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoCompatibilityHost, workspaces } from '../src/workspace.ts';
import type { NavigationIntent } from '../src/workspace.ts';

test('root identity defaults to Demo independently of journey mode and concept destination', () => {
  assert.equal(demoCompatibilityHost.workspace, 'DEMO');
  assert.deepEqual(
    workspaces.map((w) => w.id),
    ['EXPLORE', 'DEMO', 'LIVE'],
  );
  assert.equal(typeof demoCompatibilityHost.instanceId, 'string');
  const local: NavigationIntent = { kind: 'local-concept', conceptId: 'cache' };
  const reference: NavigationIntent = { kind: 'explore-concept', conceptId: 'cache' };
  assert.notEqual(local.kind, reference.kind);
});
