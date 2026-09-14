import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTrace,
  frameAt,
  toyEncode,
  toyDecode,
  distribution,
  sample,
  RunGate,
  boundedContext,
} from '../src/core.ts';
import { concepts, scenarios } from '../src/content.ts';
import { parseTokens, parseCompletion, requestText, validateEndpoint } from '../src/provider.ts';

test('every scenario connects device, infrastructure, optional computation and return', () => {
  for (const scenario of Object.values(scenarios)) {
    const trace = makeTrace(scenario.id);
    assert.equal(trace[0].conceptId, 'device');
    assert.equal(trace.at(-1)?.conceptId, 'response');
    assert(trace.some((e) => e.conceptId === 'gpu'));
    assert(trace.every((e) => concepts[e.conceptId] && e.source === 'Illustrative'));
    for (let i = trace.length - 1; i >= 0; i--)
      assert.deepEqual(frameAt(trace, i), frameAt(makeTrace(scenario.id), i));
  }
  assert(
    !makeTrace('text', true).some((e) =>
      ['router', 'internet', 'datacenter', 'rack', 'ingress'].includes(e.kind),
    ),
  );
  assert(!makeTrace('text').some((e) => ['mcp', 'image', 'denoise'].includes(e.kind)));
});
test('seek restores decode and diffusion growth, including backwards', () => {
  const t = makeTrace('text'),
    last = t.map((e) => e.kind).lastIndexOf('decode');
  assert.equal(frameAt(t, last).decode, 3);
  assert.equal(frameAt(t, 0).decode, 0);
  assert.equal(frameAt(t, -100).index, 0);
  assert.equal(frameAt(t, 999).index, t.length - 1);
  const d = makeTrace('diffusion');
  assert.equal(frameAt(d, d.length - 1).refinement, 3);
});
test('toy tokenizer is deterministic and preserves Unicode, emoji and whitespace', () => {
  for (const input of ['', ' hello\n\tworld ', '你好 sky 🌏👩🏽‍💻', 'a'.repeat(6000)]) {
    const ids = toyEncode(input);
    assert.equal(toyDecode(ids), input);
    assert.deepEqual(ids, toyEncode(input));
    assert(ids.every((n) => n >= 0 && n <= 255));
  }
});
test('stable softmax handles large scores, greedy ties, and seeded choices', () => {
  const p = distribution([10000, 9999, 9998], 0.8);
  assert(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.deepEqual(distribution([8, 8, 1], 0), [1, 0, 0]);
  assert.equal(sample(p, 42), sample(p, 42));
  assert.throws(() => distribution([Infinity], 1));
  assert.throws(() => distribution([1], -1));
});
test('selected token remains selected after sorting, with no probability renormalisation', () => {
  const [t] = parseTokens([
    {
      token: ' quiet',
      logprob: Math.log(0.1),
      top_logprobs: [
        { token: ' blue', logprob: Math.log(0.7) },
        { token: ' quiet', logprob: Math.log(0.1) },
      ],
    },
  ]);
  assert.equal(t.candidates[0].token, ' blue');
  assert.equal(t.candidates[0].chosen, false);
  assert.equal(t.candidates[1].chosen, true);
  assert(Math.abs(t.candidates.reduce((n, c) => n + c.probability, 0) - 0.8) < 1e-12);
  assert.equal(parseTokens([{ token: 'a', logprob: 0 }])[0].candidates[0].probability, 1);
});
test('gate rejects cancelled runs and late completions from a replaced run', () => {
  const gate = new RunGate(),
    a = gate.start();
  gate.cancel();
  assert(a.signal.aborted);
  assert(!gate.finish(a.id, 'completed'));
  assert.equal(gate.status, 'cancelled');
  const b = gate.start(),
    c = gate.start();
  assert(b.signal.aborted);
  assert(!gate.current(b.id));
  assert(!gate.finish(b.id, 'error'));
  assert(gate.finish(c.id, 'completed'));
  assert.equal(gate.status, 'completed');
});
test('bounded context sends whole live exchanges only and honours size limit', () => {
  const history: any[] = [
    { role: 'user', content: 'demo', mode: 'demo' },
    { role: 'assistant', content: 'fixture', mode: 'demo', state: 'completed' },
  ];
  for (let i = 0; i < 6; i++)
    history.push(
      { role: 'user', content: `q${i}`, mode: 'live' },
      { role: 'assistant', content: `a${i}`, mode: 'live', state: 'completed' },
    );
  history.push(
    { role: 'user', content: 'cancel', mode: 'live' },
    { role: 'assistant', content: 'partial', mode: 'live', state: 'cancelled' },
  );
  const messages = boundedContext(history, 'new');
  assert.equal(messages.length, 10);
  assert.equal(messages[1].content, 'q2');
  assert.equal(messages.at(-1)?.content, 'new');
  assert.equal(
    boundedContext(
      [
        { role: 'user', content: 'x'.repeat(7000), mode: 'live' },
        { role: 'assistant', content: 'answer', mode: 'live', state: 'completed' },
      ],
      'y'.repeat(6000),
    ).length,
    2,
  );
});
test('final JSON preserves whitespace and tolerates missing logprobs', () => {
  const r = parseCompletion({ choices: [{ message: { content: '  你好\n ' }, finish_reason: 'stop' }] });
  assert.equal(r.text, '  你好\n ');
  assert.deepEqual(r.tokens, []);
  assert.throws(() => parseCompletion({ choices: [] }));
});
const config = {
  url: 'http://localhost:9000/v1',
  model: 'test',
  key: 'test-key',
  stream: true,
  logprobs: false,
};
test('stream parser handles arbitrary byte boundaries, CRLF, UTF-8, usage and completion', async () => {
  const data =
    'data: ' +
    JSON.stringify({ choices: [{ delta: { content: ' 你好🌏\n' }, finish_reason: null }] }) +
    '\r\n\r\ndata: ' +
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
    '\n\ndata: ' +
    JSON.stringify({ choices: [], usage: { completion_tokens: 3 } }) +
    '\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(data);
  let index = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (index < bytes.length) c.enqueue(bytes.slice(index, (index += 1)));
      else c.close();
    },
  });
  let calls = 0,
    received = '';
  const fetcher: any = async () => {
    calls++;
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  const result = await requestText(
    config,
    [],
    new AbortController().signal,
    (text) => (received = text),
    fetcher,
  );
  assert.equal(result.text, ' 你好🌏\n');
  assert.equal(received, result.text);
  assert.equal(result.usage?.completion_tokens, 3);
  assert.equal(calls, 1);
});
test('unsupported capability fails once without silently issuing another paid request', async () => {
  let calls = 0;
  const fetcher: any = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'logprobs unsupported' } }), { status: 400 });
  };
  await assert.rejects(
    requestText({ ...config, logprobs: true }, [], new AbortController().signal, () => {}, fetcher),
    /disable them/,
  );
  assert.equal(calls, 1);
});
test('truncated stream preserves delivered partial text and fails the lifecycle', async () => {
  let partial = '';
  const fetcher: any = async () =>
    new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }) + '\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  await assert.rejects(
    requestText(config, [], new AbortController().signal, (text) => (partial = text), fetcher),
    /before completion/,
  );
  assert.equal(partial, 'partial');
});
test('endpoint excludes embedded credentials and insecure remote transport', () => {
  assert.equal(validateEndpoint('http://localhost:9000/v1/'), 'http://localhost:9000/v1');
  assert.throws(() => validateEndpoint('http://example.com/v1'));
  assert.throws(() => validateEndpoint('https://user:secret@example.com/v1'));
});
