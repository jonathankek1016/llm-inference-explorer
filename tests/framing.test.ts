import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalOrientation,
  captureFraming,
  framingRegistry,
  framingStageKey,
  resolveComposition,
  resolveFramingProfile,
  teachingDuration,
} from '../src/framing.ts';
import type { FramingRegistry } from '../src/framing.ts';
import { makeTrace } from '../src/core.ts';
import { resolveGuidedFraming } from '../src/camera.ts';
import { placeCallout } from '../src/callouts.ts';

test('framing layers inherit defaults, scene, subject and stage without mutating authored data', () => {
  const original = JSON.stringify(framingRegistry);
  const drafts: FramingRegistry = {
    defaults: { guidedZoom: 1.2 },
    scenes: { model: { preferredCalloutRegion: 'left', compositionOffset: [-30, 40] } },
    subjects: { model: { block: { guidedZoom: 1.4 } } },
    stages: { sample: { guidedZoom: 1.6 } },
  };
  const profile = resolveFramingProfile('model', 'block', 'sample', false, drafts);
  assert.equal(profile.guidedZoom, 1.6);
  assert.deepEqual(profile.anchorOffset, [0, 2, 0]);
  assert.deepEqual(profile.compositionOffset, [-30, 40]);
  assert.equal(profile.preferredCalloutRegion, 'left');
  assert.equal(resolveFramingProfile('world', 'device').guidedZoom, 1.65);
  assert.deepEqual(resolveGuidedFraming('model', 'block', [2, 0, -0.8], profile), {
    target: [2, 2, -0.8],
    zoom: 1.6,
  });
  assert.equal(JSON.stringify(framingRegistry), original);
});

test('entry shots may override framing and orientation; same-scene profiles cannot set orientation', () => {
  const drafts: FramingRegistry = {
    sceneEntries: {
      model: { guidedZoom: 1.1, cameraOrientation: [-10, 8, 15], compositionOffset: [20, 70] },
    },
  };
  const subject = resolveFramingProfile('model', 'block', undefined, false, drafts);
  assert.equal(subject.guidedZoom, 1.35);
  assert.equal(subject.cameraOrientation, undefined);
  const entry = resolveFramingProfile('model', 'block', undefined, true, drafts);
  assert.equal(entry.guidedZoom, 1.1);
  assert.deepEqual(entry.cameraOrientation, [-10, 8, 15]);
  assert.deepEqual(
    resolveFramingProfile('world', 'device', undefined, true).cameraOrientation,
    canonicalOrientation,
  );
});

test('callout-aware defaults use measured height and explicit composition overrides including zero win', () => {
  assert.deepEqual(resolveComposition({}, { width: 240, height: 200 }), [0, 36]);
  assert.deepEqual(resolveComposition({}, { width: 240, height: 600 }), [0, 64]);
  assert.deepEqual(resolveComposition({ compositionOffset: [0, 0] }, { width: 240, height: 200 }), [0, 0]);
  const bounds = { left: 0, top: 0, right: 1400, bottom: 1000 };
  const anchor = { x: 600, y: 400, visible: true };
  assert.deepEqual(placeCallout(anchor, 200, 100, bounds, false, 'left'), { x: 372, y: 350 });
  assert.deepEqual(placeCallout(anchor, 200, 100, bounds, false, 'below'), { x: 500, y: 424 });
  assert.deepEqual(placeCallout(anchor, 200, 100, bounds, false, 'upper-right'), { x: 628, y: 276 });
});

test('duration falls back to the trace, distinguishes routes and repeated stages, and resets by removing draft', () => {
  const trace = makeTrace('text');
  const decode = trace.filter((event) => event.kind === 'decode');
  const key = framingStageKey(decode[0], false);
  assert.notEqual(key, framingStageKey(decode[1], false));
  assert.notEqual(key, framingStageKey(decode[0], true));
  const drafts: FramingRegistry = { stages: { [key]: { teachingDurationMs: 8400 } } };
  assert.equal(teachingDuration(decode[0], false), 5000);
  assert.equal(teachingDuration(decode[0], false, drafts), 8400);
  assert.equal(teachingDuration(decode[1], false, drafts), 5000);
  delete drafts.stages![key];
  assert.equal(teachingDuration(decode[0], false, drafts), 5000);
  assert.equal(
    teachingDuration(decode[0], false, { subjects: { model: { decode: { teachingDurationMs: 4000 } } } }),
    4000,
  );
});

test('capture exports deterministic registry JSON, rounding poses and excluding entry-only orientation from stages', () => {
  const profile = {
    guidedZoom: 1.38000001,
    anchorOffset: [0, 0.8, 0] as const,
    compositionOffset: [-72, 36] as const,
    cameraOrientation: [-10, 8, 15] as const,
    teachingDurationMs: 8200,
  };
  const text = captureFraming('stage', 'text:cloud:text-0', profile);
  assert.equal(text, captureFraming('stage', 'text:cloud:text-0', profile));
  const data = JSON.parse(text).stages['text:cloud:text-0'];
  assert.equal(data.guidedZoom, 1.38);
  assert.equal(data.teachingDurationMs, 8200);
  assert.equal(data.cameraOrientation, undefined);
  const entry = JSON.parse(captureFraming('entry', 'model', profile)).sceneEntries.model;
  assert.deepEqual(entry.cameraOrientation, [-10, 8, 15]);
  assert.equal(entry.teachingDurationMs, undefined);
});
