import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsv, hsvToHex } from '../src/colour-picker.ts';

test('picker conversions preserve HEX colours, hue sectors and achromatic endpoints', () => {
  for (const [hex, hsv] of [
    ['#ff0000', { h: 0, s: 100, v: 100 }],
    ['#ffff00', { h: 60, s: 100, v: 100 }],
    ['#00ff00', { h: 120, s: 100, v: 100 }],
    ['#00ffff', { h: 180, s: 100, v: 100 }],
    ['#0000ff', { h: 240, s: 100, v: 100 }],
    ['#ff00ff', { h: 300, s: 100, v: 100 }],
    ['#ffffff', { h: 0, s: 0, v: 100 }],
    ['#000000', { h: 0, s: 0, v: 0 }],
  ] as const) {
    assert.deepEqual(hexToHsv(hex), hsv);
    assert.equal(hsvToHex(hsv), hex);
  }
  assert.equal(hsvToHex({ h: 360, s: 100, v: 100 }), '#ff0000');
  for (const hex of ['#397e68', '#75618f', '#935f72', '#a06a3f', '#ffffff', '#000001', '#010000', '#888888'])
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
});
