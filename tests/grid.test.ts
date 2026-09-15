import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGridIntensity, gridOpacity } from '../src/grid.ts';

test('shared grid default matches previous light 30 and preserves dark 25', () => {
  assert.equal(defaultGridIntensity, 25);
  for (const [original, preferred, maximum] of [
    [0.045, 0.09984, 0.39936],
    [0.028, 0.06688, 0.26752],
  ]) {
    assert.equal(gridOpacity(0, original), 0);
    assert.equal(gridOpacity(25, original), preferred);
    assert.equal(gridOpacity(100, original), maximum);
    assert.equal(gridOpacity(-10, original), 0);
    assert.equal(gridOpacity(110, original), maximum);
  }
  assert.equal(gridOpacity(25, 0.045), 0.0832 * (30 / 25));
});

test('grid opacity has a single constant slope throughout 0–100, including the default', () => {
  for (const original of [0.045, 0.028]) {
    const maximum = gridOpacity(100, original);
    for (let value = 0; value <= 100; value += 0.25) {
      const opacity = gridOpacity(value, original);
      assert(Math.abs(opacity - maximum * (value / 100)) < 1e-12);
      assert(opacity >= 0 && opacity <= maximum);
      if (value > 0) assert(Math.abs(opacity - gridOpacity(value - 0.25, original) - maximum / 400) < 1e-12);
      if (original === 0.028) assert.equal(opacity, 0.06688 * (value / 25));
    }
  }
});
