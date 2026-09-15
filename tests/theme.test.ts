import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  palettes,
  makeTheme,
  readAppearance,
  readDarkAppearance,
  contrast,
  sceneColours,
  mix,
} from '../src/theme.ts';

test('preset and extreme custom colours retain readable semantic text in both modes', () => {
  const choices = [
    ...palettes.map((p) => ({ palette: p.id, custom: '#397e68' })),
    ...[
      '#ffffff',
      '#000000',
      '#ffff00',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#fdfafa',
      '#151515',
      '#888888',
      '#ff00ff',
      '#00ffff',
    ].map((custom) => ({ palette: 'custom', custom })),
  ];
  for (const appearance of choices)
    for (const dark of [false, true]) {
      const { tokens: t } = makeTheme(appearance, dark);
      for (const [ink, surface] of [
        ['text', 'panel'],
        ['muted', 'soft'],
        ['muted', 'accent-soft'],
        ['accent', 'accent-soft'],
        ['accent', 'canvas'],
        ['accent-ink', 'accent'],
        ['accent-ink', 'accent-hover'],
        ['blue', 'blue-soft'],
        ['rose', 'rose-soft'],
        ['heat-ink', 'heat-low'],
        ['heat-ink', 'heat-high'],
      ])
        assert(
          contrast(t[ink], t[surface]) >= 4.5,
          `${appearance.palette}/${appearance.custom} ${dark ? 'dark' : 'light'} ${ink}/${surface}: ${contrast(t[ink], t[surface])}`,
        );
      if (dark) assert.equal(t.canvas, '#202228');
      const mica = mix(t.panel, dark ? '#ffffff' : '#000000', dark ? 0.07 : 0.09);
      for (const ink of ['text', 'muted', 'accent', 'blue', 'rose', 'error'])
        assert(contrast(t[ink], mica) >= 4.5, `${appearance.palette}: ${ink} over mica`);
    }
});
test('appearance preferences validate untrusted stored values and keep original Sage materials', () => {
  for (const invalid of [
    null,
    {},
    'rose',
    { palette: 'missing', custom: 'red' },
    { palette: 'custom', custom: '<script>' },
  ]) {
    const result = readAppearance(invalid);
    assert.match(result.custom, /^#[0-9a-f]{6}$/);
    assert(['custom', ...palettes.map((p) => p.id)].includes(result.palette));
  }
  assert.deepEqual(readAppearance(null), { palette: 'sage', custom: '#397e68' });
  assert.deepEqual(sceneColours(readAppearance(null)), {});
  assert.notEqual(sceneColours({ palette: 'rose', custom: '#397e68' })['#43a58f'], '#43a58f');
});

test('dark depth only changes environment tokens and preserves contrast throughout its range', () => {
  const choices = [
    ...palettes.map((p) => ({ palette: p.id, custom: '#397e68' })),
    ...['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#888888'].map((custom) => ({
      palette: 'custom',
      custom,
    })),
  ];
  for (const appearance of choices) {
    const light = makeTheme(appearance, false);
    const baseline = makeTheme(appearance, true);
    assert.deepEqual(makeTheme(appearance, true, 0), baseline);
    assert.equal(baseline.tokens.canvas, '#202228');
    let previousContrast = 0;
    for (let depth = 0; depth <= 100; depth++) {
      assert.deepEqual(makeTheme(appearance, false, depth), light);
      const { tokens } = makeTheme(appearance, true, depth);
      for (const key of Object.keys(tokens))
        if (key !== 'canvas' && key !== 'chrome') assert.equal(tokens[key], baseline.tokens[key]);
      assert.equal(tokens.chrome, tokens.canvas);
      const currentContrast = contrast(tokens.text, tokens.canvas);
      assert(currentContrast >= previousContrast);
      previousContrast = currentContrast;
      for (const ink of ['text', 'muted', 'accent']) assert(contrast(tokens[ink], tokens.canvas) >= 4.5);
      // Smoked mica over the deeper canvas stays readable, even over white models.
      for (const backing of [tokens.canvas, '#ffffff']) {
        const mica = mix(tokens.panel, backing, 0.07);
        for (const ink of ['text', 'muted', 'accent', 'blue', 'rose', 'error'])
          assert(contrast(tokens[ink], mica) >= 4.5);
      }
    }
    assert.equal(makeTheme(appearance, true, 100).tokens.canvas, '#101217');
  }
});

test('dark depth validates stored preferences and defaults safely', () => {
  for (const invalid of [undefined, null, {}, [], '50', NaN, Infinity, -Infinity])
    assert.equal(readDarkAppearance(invalid), 0);
  assert.equal(readDarkAppearance(-1), 0);
  assert.equal(readDarkAppearance(101), 100);
  assert.equal(readDarkAppearance(49.7), 50);
});
