import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatObservations } from '../src/provider-observations.ts';
import type { ProviderObservation } from '../src/live-observations.ts';
import {
  parseCompletion,
  requestText,
  requestImageUnderstanding,
  requestImageGeneration,
} from '../src/provider.ts';
import type { ProviderResult } from '../src/provider.ts';
import { LiveRequests } from '../src/live-request.ts';
import { LiveJourney } from '../src/live-journey.ts';
import { textCapabilities, mediaCapabilities } from '../src/live-capabilities.ts';
import type { WorkspaceInstanceId } from '../src/workspace.ts';

const config = { url: 'https://example.test/v1', model: 'mock', key: '', stream: false, logprobs: false };
const owner = { workspace: 'LIVE' as const, instanceId: 'live:one' as WorkspaceInstanceId };
const call = {
  id: 'call_1',
  type: 'function',
  function: { name: 'weather', arguments: '{"city":"Singapore"}' },
};
const completion = {
  choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }],
};
const citation = {
  type: 'url_citation',
  url_citation: {
    title: 'Returned source',
    url: 'https://example.test/source',
    start_index: 0,
    end_index: 5,
  },
};
const input = { prompt: 'weather documents search RAG MCP calculate', config };

test('incorrect user declarations surface the genuine error safely without downgrading or retrying capabilities', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json(
      { error: { message: 'Image schema unsupported; credential-secret' } },
      { status: 400 },
    );
  };
  const requests = new LiveRequests({
    generationTransport: (c, p, s) => requestImageGeneration(c, p, s, fetcher),
  });
  const accepted = requests.start(owner, {
    ...input,
    requestType: 'IMAGE_GENERATION',
    config: { ...config, key: 'credential-secret' },
    backendCapabilities: { imageGeneration: 'SUPPORTED', generatedMedia: 'SUPPORTED' },
  });
  assert(accepted.accepted);
  const result = await accepted.completion;
  assert.equal(result.state, 'FAILED');
  assert.equal(result.capabilities.backend.imageGeneration.support, 'SUPPORTED');
  assert.equal(result.capabilities.backend.imageGeneration.origin, 'USER_DECLARED');
  assert(result.error?.kind !== 'UNKNOWN');
  assert.match(String(result.error?.value), /Image schema unsupported/);
  assert(!JSON.stringify(result).includes('credential-secret'));
  assert.equal(calls, 1);
});

test('JSON modern/legacy calls are observable data, not execution; content-less calls are legal only in Live transport', async () => {
  const result = parseCompletion(completion);
  assert.equal(result.textReturned, false);
  assert.equal(result.text, '');
  assert.deepEqual(result.observations?.[0], {
    kind: 'tool-call',
    key: 'tool:0',
    providerCallId: 'call_1',
    name: 'weather',
    arguments: '{"city":"Singapore"}',
    phase: 'RETURNED',
    truncated: false,
    executionOwner: 'UNKNOWN',
    execution: 'NOT_OBSERVED',
  });
  const legacy = parseCompletion({ choices: [{ message: { function_call: call.function } }] });
  assert.equal(legacy.observations?.[0].key, 'legacy:0');
  const seen: ProviderObservation[] = [];
  const fetcher: typeof fetch = async () => Response.json(completion);
  await requestText(
    config,
    [],
    new AbortController().signal,
    () => assert.fail('no invented text'),
    fetcher,
    (e) => seen.push(e),
  );
  assert.equal(seen.length, 1);
  await assert.rejects(
    requestText(config, [], new AbortController().signal, () => {}, fetcher),
    /No text response/,
  );
  assert.throws(
    () => parseCompletion({ choices: [{ message: { content: null, tool_calls: [{}] } }] }),
    /No text/,
  );
});

test('interleaved streaming fragments keep separate call identities, partial snapshots and bounded untrusted arguments', () => {
  const events: ProviderObservation[] = [];
  const parser = new ChatObservations((e) => events.push(e));
  parser.read(
    {
      tool_calls: [
        { index: 1, id: 'b', type: 'function', function: { name: 'second', arguments: '{' } },
        { index: 0, id: 'a', function: { name: 'first', arguments: '[' } },
      ],
    },
    true,
  );
  const initial = parser.snapshot;
  parser.read(
    {
      tool_calls: [
        { index: 0, function: { arguments: '1]' } },
        { index: 1, function: { arguments: '"x":2}' } },
      ],
    },
    true,
  );
  parser.finish();
  const calls = parser.snapshot;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind === 'tool-call' && calls[0].arguments, '{"x":2}');
  assert.equal(calls[1].kind === 'tool-call' && calls[1].arguments, '[1]');
  assert.equal(initial[0].kind === 'tool-call' && initial[0].phase, 'PARTIAL');
  assert.equal(initial[0].kind === 'tool-call' && initial[0].arguments, '{');
  const before = events.length;
  parser.finish();
  assert.equal(events.length, before);
  parser.read(
    {
      tool_calls: [
        { index: -1, function: call.function },
        { index: 99, function: call.function },
        { index: 2, type: 'custom', function: call.function },
      ],
    },
    true,
  );
  assert.equal(parser.snapshot.length, 2);
  parser.read(
    { tool_calls: [{ index: 3, function: { name: 'large', arguments: 'x'.repeat(20000) } }] },
    true,
  );
  const bounded = parser.snapshot[2];
  assert(bounded.kind === 'tool-call');
  assert.equal(bounded.arguments?.length, 16384);
  assert.equal(bounded.truncated, true);
});

test('only structured citations become source references; unsafe links and prose do not become search evidence', () => {
  const parser = new ChatObservations();
  parser.read({
    content: 'I searched the web https://invented.test',
    annotations: [
      citation,
      citation,
      { ...citation, url_citation: { url: 'javascript:alert(1)' } },
      { ...citation, url_citation: { url: 'https://user:secret@example.test' } },
    ],
  });
  assert.equal(parser.snapshot.length, 1);
  assert.deepEqual(parser.snapshot[0], {
    kind: 'source-reference',
    key: 'source:https://example.test/source:0:5',
    url: 'https://example.test/source',
    title: 'Returned source',
    startIndex: 0,
    endIndex: 5,
    acquisition: 'UNKNOWN',
  });
  assert.equal(textCapabilities().adapter.toolObservations.support, 'SUPPORTED');
  assert.equal(textCapabilities().adapter.toolCalling.support, 'UNSUPPORTED');
  assert.equal(textCapabilities().backend.toolObservations.support, 'UNKNOWN');
  assert.equal(mediaCapabilities('IMAGE_GENERATION').adapter.toolObservations.support, 'UNSUPPORTED');
});

test('real SSE decoder emits progressive tools/citations and accepts a tool-only finish; truncated stream does not finalize calls', async () => {
  const frames = [
    {
      choices: [
        { delta: { tool_calls: [{ index: 0, ...call, function: { name: 'weather', arguments: '{' } }] } },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"city":"Singapore"}' } }],
            annotations: [citation],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
  ];
  const fetcher: typeof fetch = async () =>
    new Response(
      frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  const events: ProviderObservation[] = [];
  const result = await requestText(
    { ...config, stream: true },
    [],
    new AbortController().signal,
    () => assert.fail('no text'),
    fetcher,
    (e) => events.push(e),
  );
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.observations?.length, 2);
  assert.equal(events[0].kind === 'tool-call' && events[0].phase, 'PARTIAL');
  assert.equal(events.at(-1)?.kind === 'tool-call' && (events.at(-1) as any).phase, 'RETURNED');
  const truncated: typeof fetch = async () =>
    new Response(`data: ${JSON.stringify(frames[0])}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  const partial: ProviderObservation[] = [];
  await assert.rejects(
    requestText(
      config,
      [],
      new AbortController().signal,
      () => {},
      truncated,
      (e) => partial.push(e),
    ),
    /before completion/,
  );
  assert(partial.every((e) => e.kind !== 'tool-call' || e.phase === 'PARTIAL'));
});

test('image-understanding transport reuses observations without modifying image encoding or making execution requests', async () => {
  let count = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    count++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.messages[0].content[1].type, 'image_url');
    assert.equal('tools' in body, false);
    return Response.json(completion);
  };
  const events: ProviderObservation[] = [];
  await requestImageUnderstanding(
    config,
    { dataUrl: 'data:image/png;base64,AA==' } as any,
    'inspect',
    new AbortController().signal,
    () => {},
    fetcher,
    (e) => events.push(e),
  );
  assert.equal(events.length, 1);
  assert.equal(count, 1);
});

test('observations append/enrich stable stages, survive completion/parking/End, and retain owning request capability snapshot', async () => {
  let send!: (e: ProviderObservation) => void;
  let resolve!: (r: ProviderResult) => void;
  const requests = new LiveRequests({
    transport: async (_c, _m, _s, _d, _f, observation) => {
      send = observation!;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const declarations = { imageText: 'SUPPORTED' as const };
  const accepted = requests.start(owner, { ...input, backendCapabilities: declarations });
  assert(accepted.accepted);
  const journey = new LiveJourney();
  journey.receive(requests.current!);
  journey.restart();
  journey.tick(100);
  journey.action({ type: 'DETACH' });
  const stage = journey.current;
  const parser = new ChatObservations(send);
  parser.read({ tool_calls: [{ index: 0, ...call, function: { name: 'weather', arguments: '{' } }] }, true);
  journey.receive(requests.current!);
  const toolStage = journey.stages.at(-1)!;
  parser.read({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }, true);
  journey.receive(requests.current!);
  assert.equal(journey.current, stage);
  assert.equal(journey.elapsed, 100);
  assert.equal(journey.stages.at(-1)?.id, toolStage.id);
  assert.equal(journey.stages.at(-1)?.events.length, 2);
  journey.action({ type: 'COMPLETE' });
  const retained = journey.stages;
  (declarations as any).imageText = 'UNSUPPORTED';
  parser.finish();
  resolve({ text: '', textReturned: false, tokens: [], observations: parser.snapshot });
  const result = await accepted.completion;
  journey.receive(result);
  assert.equal(journey.stages, retained);
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.result?.text.kind, 'UNKNOWN');
  assert.equal(result.capabilities.backend.imageText.support, 'SUPPORTED');
  assert.equal(result.capabilities.backend.imageText.origin, 'USER_DECLARED');
  assert.equal(result.events.filter((e) => e.kind === 'tool-call').length, 3); // final fallback deduplicated
  assert(
    result.events.every((e) => e.requestId === accepted.requestId && e.owner.instanceId === owner.instanceId),
  );
  journey.restart();
  assert.equal(journey.stages.filter((s) => s.conceptId === 'intent').length, 1);
  assert.equal(journey.control.completed, false);
});

test('cancellation fences late tool events/results and a newer request cannot inherit them; keywords never produce observations', async () => {
  const pending: { send: (e: ProviderObservation) => void; resolve: (r: ProviderResult) => void }[] = [];
  const requests = new LiveRequests({
    transport: async (_c, _m, _s, _d, _f, observation) =>
      new Promise((resolve) => {
        pending.push({ send: observation!, resolve });
      }),
  });
  const first = requests.start(owner, input);
  assert(first.accepted);
  assert.equal(requests.start(owner, input).accepted, false);
  requests.cancel(first.requestId);
  const second = requests.start(owner, input);
  assert(second.accepted);
  const observation = parseCompletion(completion).observations![0];
  pending[0].send(observation);
  pending[0].resolve(parseCompletion(completion));
  pending[1].resolve({ text: 'A plain answer about weather, RAG and MCP', tokens: [] });
  const result = await second.completion;
  assert.equal(
    result.events.some((e) => ['tool-call', 'source-reference'].includes(e.kind)),
    false,
  );
  assert.equal(requests.get(first.requestId)?.state, 'CANCELLED');
  assert.equal(requests.current?.id, second.requestId);
});
