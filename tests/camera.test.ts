import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusEase, resolveGuidedFraming } from '../src/camera.ts';

test('guided framing resolves only visible subjects, with conservative scene overrides', () => {
  assert.equal(resolveGuidedFraming('world', 'context'), undefined);
  assert.deepEqual(resolveGuidedFraming('compute', 'gpu', [3.5, 0, 1.5]), {
    target: [3.5, 0.8, 1.5],
    zoom: 1.65,
  });
  assert.deepEqual(resolveGuidedFraming('world', 'datacenter', [5, 0, 0]), {
    target: [5, 1.4, 0],
    zoom: 1.35,
  });
  assert.deepEqual(resolveGuidedFraming('model', 'block', [2, 0, -0.8]), {
    target: [2, 2, -0.8],
    zoom: 1.35,
  });
});

test('focus retains exponential easing, frame-rate independence, and reduced-motion completion', () => {
  assert.equal(focusEase(0), 0);
  assert.equal(focusEase(-1), 0);
  assert.equal(focusEase(0.016, true), 1);
  assert.ok(focusEase(0.1) > 0 && focusEase(0.1) < 1);
  assert.ok(focusEase(0.1) > focusEase(0.2) - focusEase(0.1));
  assert.ok(Math.abs((1 - focusEase(0.05)) ** 2 - (1 - focusEase(0.1))) < 1e-12);
});
