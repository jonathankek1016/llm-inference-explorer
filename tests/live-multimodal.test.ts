import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveRequests } from '../src/live-request.ts';
import { LiveJourney } from '../src/live-journey.ts';
import { GuidedSessions } from '../src/guided-session.ts';
import type { WorkspaceInstanceId } from '../src/workspace.ts';
import { mediaDeclarations } from '../src/live-input.ts';
import { mediaCapabilities, checkMediaCapabilities } from '../src/live-capabilities.ts';
import { normalizeGeneratedImages, validateImage } from '../src/live-media.ts';
import { requestImageUnderstanding, requestImageGeneration } from '../src/provider.ts';
import type { ImageGenerationResult } from '../src/provider.ts';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMwmrbq2b4UBggFAC8MBvW/U/rjAAAAAElFTkSuQmCC';
const image = {
  id: 'input:1',
  mime: 'image/png' as const,
  bytes: atob(png).length,
  width: 2,
  height: 2,
  dataUrl: `data:image/png;base64,${png}`,
};
const owner = { workspace: 'LIVE' as const, instanceId: 'live:test' as WorkspaceInstanceId, label: 'Live' };
const config = {
  url: 'https://example.test/v1',
  model: 'unknown-brand',
  key: '',
  stream: false,
  logprobs: false,
};
const declarations = {
  imageText: 'SUPPORTED' as const,
  imageGeneration: 'SUPPORTED' as const,
  generatedMedia: 'SUPPORTED' as const,
};
const generation = {
  requestType: 'IMAGE_GENERATION' as const,
  prompt: 'An image of documents and tools',
  config,
  backendCapabilities: declarations,
};

test('multimodal capability gates require positive scoped declarations and do not infer branding or keywords', async () => {
  for (const kind of ['IMAGE_UNDERSTANDING', 'IMAGE_GENERATION'] as const) {
    assert(checkMediaCapabilities(mediaCapabilities(kind), kind, config).length);
    assert.equal(checkMediaCapabilities(mediaCapabilities(kind, declarations), kind, config).length, 0);
  }
  const profile = mediaCapabilities('IMAGE_UNDERSTANDING', declarations);
  assert.deepEqual(
    checkMediaCapabilities(profile, 'IMAGE_UNDERSTANDING', { ...config, stream: true, logprobs: true }),
    ['streaming', 'logprobs'],
  );
  assert.equal(profile.backend.cancellation.support, 'UNKNOWN');
  assert.equal(profile.adapter.cancellation.support, 'SUPPORTED');
  assert.deepEqual(
    mediaDeclarations({
      ...config,
      media: {
        ...config,
        generationModel: 'g',
        ...declarations,
        streaming: 'UNKNOWN',
        logprobs: 'UNKNOWN',
        url: 'https://different.test',
      },
    }),
    {},
  );
  const requests = new LiveRequests({
    generationTransport: async () => {
      throw new Error('must not be called');
    },
  });
  for (const support of ['UNKNOWN', 'UNSUPPORTED'] as const) {
    const run = requests.start(owner, {
      ...generation,
      backendCapabilities: { ...declarations, imageGeneration: support },
    });
    assert(run.accepted);
    assert.equal((await run.completion).state, 'FAILED');
    assert(!requests.current!.events.some((e) => e.kind === 'request-sent'));
  }
});

test('image input validates media signature, declared MIME, bounds and payload', () => {
  validateImage(image);
  for (const bad of [
    { ...image, mime: 'image/jpeg' as const },
    { ...image, bytes: 20_000_000 },
    { ...image, width: 0 },
    { ...image, dataUrl: 'data:image/svg+xml;base64,AAAA' },
    { ...image, bytes: 1 },
  ])
    assert.throws(() => validateImage(bad));
});

test('image understanding uses actual content parts, shared text parser and evidence without logging media bytes', async () => {
  let body: any;
  const requests = new LiveRequests({
    imageTransport: (c, i, p, s, onData) =>
      requestImageUnderstanding(c, i, p, s, onData, async (url, init) => {
        assert.equal(url, config.url + '/chat/completions');
        body = JSON.parse(String(init?.body));
        return Response.json({
          choices: [{ message: { content: 'Two colored squares' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3 },
        });
      }),
  });
  const run = requests.start(owner, {
    requestType: 'IMAGE_UNDERSTANDING',
    image,
    prompt: '',
    config,
    backendCapabilities: declarations,
  });
  assert(run.accepted);
  const result = await run.completion;
  assert.deepEqual(body.messages[0].content, [{ type: 'image_url', image_url: { url: image.dataUrl } }]);
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.result?.text.kind, 'OBSERVED');
  assert.equal(result.events.find((e) => e.kind === 'input')?.evidence.kind, 'OBSERVED');
  assert.equal(result.events.find((e) => e.kind === 'image-metadata')?.evidence.kind, 'LOCALLY_CALCULATED');
  assert(!JSON.stringify(result.events).includes(png));
  assert.equal(result.inputImage?.id, image.id);
  const lesson = new LiveJourney();
  lesson.receive(result);
  for (const id of ['patches', 'fusion'])
    assert.equal(lesson.stages.find((s) => s.conceptId === id)?.evidence.kind, 'ILLUSTRATIVE');
});

test('image understanding retains real SSE text streaming and returned finish metadata', async () => {
  let updates = '';
  const result = await requestImageUnderstanding(
    { ...config, stream: true },
    image,
    'Describe',
    new AbortController().signal,
    (text) => (updates = text),
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[0].content[0].text, 'Describe');
      assert.equal(body.stream, true);
      return new Response(
        'data: {"choices":[{"delta":{"content":"Actual stream"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  );
  assert.equal(updates, 'Actual stream');
  assert.equal(result.finishReason, 'stop');
});

test('generation uses a distinct real endpoint and normalizes actual media plus supplied metadata', async () => {
  const output = await requestImageGeneration(
    config,
    'A real prompt',
    new AbortController().signal,
    async (url, init) => {
      assert.equal(url, config.url + '/images/generations');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: config.model,
        prompt: 'A real prompt',
        n: 1,
      });
      return Response.json({
        data: [{ b64_json: png, revised_prompt: 'Returned revision' }],
        created: 123,
        usage: { output_tokens: 2 },
      });
    },
  );
  assert.equal(output.media[0].src, image.dataUrl);
  assert.equal(output.media[0].mime, 'image/png');
  assert.equal(output.media[0].revisedPrompt, 'Returned revision');
  assert.deepEqual(output.metadata, { created: 123 });
  assert.deepEqual(output.usage, { output_tokens: 2 });
  assert.equal(
    normalizeGeneratedImages([{ url: 'https://media.example.test/image?signature=abc' }])[0].src,
    'https://media.example.test/image?signature=abc',
  );
});

test('media normalizer rejects unsafe URLs, SVG, malformed data and empty output', () => {
  for (const bad of [
    [],
    null,
    [{}],
    [{ url: 'javascript:alert(1)' }],
    [{ url: 'data:text/html,<script>' }],
    [{ url: 'https://user:secret@example.test/image' }],
    [{ url: 'http://example.test/image' }],
    [{ b64_json: btoa('<svg/>') }],
    [{ b64_json: 'not base64!' }],
  ])
    assert.throws(() => normalizeGeneratedImages(bad));
});

test('generation completion can follow educational Complete, browsing and a new Demo session; replay never resends', async () => {
  let resolve!: (r: ImageGenerationResult) => void,
    calls = 0;
  const requests = new LiveRequests({
    generationTransport: async () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
  });
  const run = requests.start(owner, generation);
  assert(run.accepted);
  const lesson = new LiveJourney();
  lesson.receive(requests.current!);
  lesson.restart();
  const sessions = new GuidedSessions();
  sessions.register(owner, {
    incomplete: () => lesson.control.active && !lesson.control.completed,
    detach: () => lesson.action({ type: 'DETACH' }),
    resume: () => lesson.action({ type: 'RESUME' }),
    end: () => lesson.action({ type: 'STOP' }),
  });
  sessions.admit(owner);
  lesson.seek(lesson.stages.length - 1);
  lesson.action({ type: 'COMPLETE' });
  sessions.reconcile(owner);
  const stage = lesson.current!.id,
    count = lesson.stages.length;
  assert.equal(sessions.current, undefined);
  sessions.browse({ workspace: 'EXPLORE' });
  const demo = { workspace: 'DEMO' as const, instanceId: 'demo' as WorkspaceInstanceId, label: 'Demo' };
  sessions.register(demo, { incomplete: () => true, detach() {}, resume() {}, end() {} });
  assert(sessions.admit(demo).allowed);
  resolve({ media: normalizeGeneratedImages([{ b64_json: png }]), metadata: {} });
  const result = await run.completion;
  lesson.receive(result);
  assert.equal(result.owner.workspace, 'LIVE');
  assert.equal(result.state, 'COMPLETED');
  assert.equal(lesson.current!.id, stage);
  assert.equal(lesson.stages.length, count);
  assert(lesson.control.completed);
  lesson.action({ type: 'EXPLORE' });
  assert.equal(requests.current!.media!.length, 1);
  lesson.restart();
  assert.equal(calls, 1);
  assert.equal(lesson.stages.length, count + 1);
  for (const id of ['conditioning', 'noise', 'denoise'])
    assert.equal(lesson.stages.find((s) => s.conceptId === id)?.evidence.kind, 'ILLUSTRATIVE');
  assert.equal(lesson.stages.at(-1)!.evidence.kind, 'OBSERVED');
});

test('all families share admission; cancellation fences stale media and does not stop the lesson', async () => {
  const calls: { resolve: (r: ImageGenerationResult) => void; signal: AbortSignal }[] = [];
  const requests = new LiveRequests({
    generationTransport: async (_c, _p, signal) => new Promise((resolve) => calls.push({ resolve, signal })),
  });
  const first = requests.start(owner, generation);
  assert(first.accepted);
  const lesson = new LiveJourney();
  lesson.receive(requests.current!);
  lesson.restart();
  assert.equal(requests.start(owner, { config, prompt: 'Text' }).accepted, false);
  assert.equal(
    requests.start(owner, { config, prompt: '', requestType: 'IMAGE_UNDERSTANDING', image }).accepted,
    false,
  );
  requests.cancel(first.requestId);
  assert(calls[0].signal.aborted);
  assert(lesson.control.active);
  const next = requests.start(owner, generation);
  assert(next.accepted);
  calls[0].resolve({ media: normalizeGeneratedImages([{ b64_json: png }]), metadata: {} });
  await first.completion;
  assert.equal(requests.current!.id, next.requestId);
  assert.equal(requests.current!.media, undefined);
  calls[1].resolve({
    media: normalizeGeneratedImages([{ url: 'https://media.example.test/new.png' }]),
    metadata: {},
  });
  await next.completion;
  assert.equal(requests.current!.media![0].src, 'https://media.example.test/new.png');
});

test('multimodal failures redact credentials and raw image payloads', async () => {
  const requests = new LiveRequests({
    imageTransport: async () => {
      throw new Error(`credential-secret ${image.dataUrl} ${png}`);
    },
  });
  const run = requests.start(owner, {
    requestType: 'IMAGE_UNDERSTANDING',
    image,
    prompt: '',
    config: { ...config, key: 'credential-secret' },
    backendCapabilities: declarations,
  });
  assert(run.accepted);
  const result = await run.completion;
  assert.equal(result.state, 'FAILED');
  assert(!JSON.stringify(result.error).includes('credential-secret'));
  assert(!JSON.stringify(result.error).includes(png));
});
