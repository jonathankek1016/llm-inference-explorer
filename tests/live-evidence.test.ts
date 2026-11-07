import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textCapabilities, checkTextCapabilities, liveFeatures } from '../src/live-capabilities.ts';
import { LiveEventLog } from '../src/live-events.ts';
import type { LiveRequestId, LiveRequestOwner } from '../src/live-events.ts';
import type { WorkspaceInstanceId } from '../src/workspace.ts';
import { LiveTraceBuilder } from '../src/live-trace.ts';
import { observed, calculated, unknown } from '../src/provenance.ts';
import type { Evidence } from '../src/provenance.ts';
import { usageGraph } from '../src/usage-graph.ts';

const owner: LiveRequestOwner = { workspace: 'LIVE', instanceId: 'live:one' as WorkspaceInstanceId };
const id = 'request:one' as LiveRequestId;

test('adapter and backend capability claims are separate; only explicit declarations change unknown backend support', () => {
  const profile = textCapabilities();
  assert.equal(profile.adapter.text.support, 'SUPPORTED');
  assert.equal(profile.adapter.cancellation.support, 'SUPPORTED');
  for (const feature of [
    'mcp',
    'rag',
    'webSearch',
    'imageText',
    'imageGeneration',
    'generatedMedia',
    'toolCalling',
  ] as const)
    assert.equal(profile.adapter[feature].support, 'UNSUPPORTED');
  for (const feature of liveFeatures) {
    assert.equal(profile.backend[feature].support, 'UNKNOWN');
    assert.equal(profile.backend[feature].origin, 'UNADVERTISED');
  }
  assert.deepEqual(checkTextCapabilities(profile, { stream: true, logprobs: true }), []);
  const declared = textCapabilities({ text: 'SUPPORTED', streaming: 'UNSUPPORTED', logprobs: 'UNKNOWN' });
  assert.deepEqual(checkTextCapabilities(declared, { stream: true, logprobs: true }), ['streaming']);
  assert.equal(declared.backend.text.origin, 'BACKEND_DECLARATION');
  assert.equal(profile.backend.text.support, 'UNKNOWN');
  assert.throws(() => {
    (profile.backend.text as any).support = 'SUPPORTED';
  });
  assert.equal(
    usageGraph.entries.some((entry) => entry.workspace === 'LIVE'),
    false,
  );
});

test('event log snapshots retain each provenance class, known receipt times and immutable append order', () => {
  let clock = 100;
  const log = new LiveEventLog(id, owner, () => clock--); // wall clocks can move backwards: sequence still orders
  const evidence: Evidence<unknown>[] = [
    observed('returned', 'PROVIDER', 'Explicit response'),
    calculated(12, 'Client elapsed'),
    { kind: 'ILLUSTRATIVE', source: 'AUTHORED', basis: 'Authored model', value: { model: 'gpu' } },
    {
      kind: 'INFERRED_REPRESENTATIVE',
      source: 'INTERPRETATION',
      basis: 'Architecture example, not execution evidence',
      value: 'cache',
    },
    unknown('Hidden network route unavailable'),
  ];
  for (const item of evidence) log.append({ requestId: id, kind: 'preparation', evidence: item });
  const events = log.events;
  assert.deepEqual(
    events.map((event) => event.evidence.kind),
    evidence.map((item) => item.kind),
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    events.map((event) => event.receivedAt),
    [100, 99, 98, 97, 96],
  );
  assert.equal('value' in events[4].evidence, false);
  assert.equal(
    log.append({
      requestId: 'request:wrong' as LiveRequestId,
      kind: 'input',
      evidence: observed('bad', 'APPLICATION', 'wrong request'),
    }),
    undefined,
  );
  assert.equal(
    log.append({
      requestId: id,
      kind: 'input',
      conceptId: 'invented',
      evidence: observed('bad', 'APPLICATION', 'wrong concept'),
    }),
    undefined,
  );
  log.append({
    requestId: id,
    kind: 'result-text',
    conceptId: 'response',
    evidence: observed('later', 'PROVIDER', 'returned text'),
  });
  assert.equal(events.length, 5);
  assert.deepEqual(log.events.slice(0, 5), events);
  assert.throws(() => {
    (events[2].evidence.value as any).model = 'observed allocation';
  });
});

test('trace append/annotation preserves stage identity/order/provenance and rejects foreign or stale evidence', () => {
  const log = new LiveEventLog(id, owner);
  const trace = new LiveTraceBuilder(id, owner);
  const initial = log.append({
    requestId: id,
    kind: 'input',
    conceptId: 'device',
    evidence: observed('documents and weather', 'APPLICATION', 'Submitted text'),
  })!;
  const first = trace.appendEvent(initial, 'Submitted input')!;
  const teaching = trace.appendTeaching('Representative GPU', 'gpu', {
    kind: 'ILLUSTRATIVE',
    source: 'AUTHORED',
    basis: 'Existing geometry',
    value: 'GPU model',
  })!;
  const earlier = trace.snapshot;
  const result = log.append({
    requestId: id,
    kind: 'result-text',
    conceptId: 'response',
    evidence: observed('response', 'PROVIDER', 'Returned text'),
  })!;
  trace.appendEvent(result, 'Returned response');
  const usage = log.append({
    requestId: id,
    kind: 'usage',
    evidence: observed({ completion_tokens: 3 }, 'PROVIDER', 'Returned usage field'),
  })!;
  assert.equal(trace.annotate(teaching.id, usage), true);
  assert.deepEqual(
    trace.snapshot.map((stage) => stage.id),
    [first.id, teaching.id, `${id}:stage:2`],
  );
  assert.equal(trace.snapshot[1].evidence.kind, 'ILLUSTRATIVE');
  assert.equal(trace.snapshot[1].events[0].evidence.kind, 'OBSERVED');
  assert.equal(earlier[1].events.length, 0);
  assert.equal(trace.appendEvent(result, 'Duplicate'), undefined);
  assert.equal(trace.annotate(teaching.id, initial), false);
  assert.equal(trace.annotate('missing', usage), false);
  assert.equal(
    trace.appendEvent(
      { ...usage, id: 'request:other:event:99', requestId: 'request:other' as LiveRequestId, sequence: 99 },
      'Foreign request',
    ),
    undefined,
  );
  assert.equal(
    trace.appendEvent(
      {
        ...usage,
        id: `${id}:event:99`,
        owner: { workspace: 'LIVE', instanceId: 'live:other' as WorkspaceInstanceId },
        sequence: 99,
      },
      'Foreign workspace',
    ),
    undefined,
  );
  assert.equal(trace.appendTeaching('Invented geometry', 'invented', unknown('no model')), undefined);
  assert.equal(
    trace.appendTeaching(
      'Fake telemetry',
      'gpu',
      observed('allocation', 'PROVIDER', 'not a teaching source') as any,
    ),
    undefined,
  );
  assert.equal(trace.snapshot.length, 3);
  assert.equal(
    trace.appendEvent({ ...usage, id: `${id}:event:Infinity`, sequence: Infinity }, 'Invalid sequence'),
    undefined,
  );
  assert.equal(
    trace.appendEvent({ ...usage, id: `${id}:event:99`, sequence: 99, receivedAt: NaN }, 'Invalid time'),
    undefined,
  );
  const fabricatedUnknown = {
    kind: 'UNKNOWN',
    source: 'UNAVAILABLE',
    basis: 'Unavailable',
    value: 'pretend',
  } as any;
  assert.equal(log.append({ requestId: id, kind: 'usage', evidence: fabricatedUnknown }), undefined);
  assert.equal(trace.appendTeaching('False unknown', 'cache', fabricatedUnknown), undefined);
  assert.equal(
    log.append({
      requestId: id,
      kind: 'invented-event',
      evidence: observed('data', 'APPLICATION', 'Unknown event'),
    } as any),
    undefined,
  );
});
