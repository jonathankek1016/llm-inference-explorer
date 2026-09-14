import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Visual-only audit against the running production preview, at native 100% zoom.
const output = 'artifacts/refinement';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#viewport canvas').waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme').click();
    for (const [width, height] of [
      [2048, 1140],
      [1920, 1080],
      [1440, 960],
      [1366, 768],
      [1280, 720],
      [1024, 768],
      [820, 1180],
      [900, 700],
      [390, 844],
      [360, 640],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
      const measurements = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            width: r.width,
            height: r.height,
          };
        };
        const font = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        return {
          viewportScale: visualViewport.scale,
          deviceScale: devicePixelRatio,
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          zoom: root.zoom,
          rootFont: parseFloat(root.fontSize),
          title: rect('#scene-title'),
          intro: rect('.scene-intro'),
          introPosition: getComputedStyle(document.querySelector('.scene-intro')).position,
          panel: rect('#journey-panel'),
          canvas: rect('#viewport'),
          framing: rect('#scene-framing'),
          headerBorder: getComputedStyle(document.querySelector('.masthead')).borderBottomWidth,
          headingOutsideMain: !document
            .querySelector('main')
            .contains(document.querySelector('.scene-intro')),
          stageFont: font('.stage'),
          labelFont: font('.object-label'),
        };
      });
      assert.equal(measurements.viewportScale, 1);
      assert.equal(measurements.deviceScale, 1);
      assert.equal(measurements.zoom, '1');
      assert.equal(measurements.rootFont, 17.6);
      assert.equal(measurements.documentWidth, width, `${theme} ${width}: horizontal scroll`);
      assert.equal(measurements.documentHeight, height, `${theme} ${width}: vertical page scroll`);
      assert(measurements.headingOutsideMain);
      assert.equal(measurements.introPosition, 'absolute');
      if (width > 980) assert(measurements.panel.top < 170, `${theme} ${width}: workspace pushed down`);
      assert(
        measurements.framing.top >= measurements.intro.bottom,
        `${theme} ${width}: heading/framing overlap`,
      );
      assert.equal(measurements.headerBorder, '0px');
      assert.equal(measurements.canvas.top, 0);
      assert.equal(measurements.canvas.left, 0);
      assert.equal(measurements.canvas.width, width);
      assert.equal(measurements.canvas.height, height);
      assert(measurements.title.bottom <= measurements.intro.bottom, `${theme} ${width}: heading overflow`);
      assert(measurements.canvas.height > 120, `${theme} ${width}: canvas too short`);
      results.push({ theme, width, height, ...measurements });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    for (const scene of ['Model', 'Block']) {
      await page.getByRole('button', { name: scene, exact: true }).click();
      await page.getByRole('tab', { name: 'Data', exact: true }).click();
      await page.screenshot({ path: `${output}/${theme}-${scene.toLowerCase()}.png` });
    }
    const contrast = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const parse = (value) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const lum = (rgb) =>
        rgb
          .map((c) => c / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (foreground, background) => {
        const a = lum(parse(foreground)),
          b = lum(parse(background));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const pairs = [
        ['text', 'panel-solid'],
        ['muted', 'canvas'],
        ['muted', 'soft'],
        ['accent', 'accent-soft'],
        ['blue', 'blue-soft'],
        ['rose', 'rose-soft'],
        ['accent-ink', 'accent'],
      ];
      const pairsResult = pairs.map(([text, surface]) => ({
        text,
        surface,
        ratio: ratio(css.getPropertyValue('--' + text), css.getPropertyValue('--' + surface)),
      }));
      const heatmap = [...document.querySelectorAll('.heat-cell:not(.masked)')].map((cell) => {
        const s = getComputedStyle(cell);
        return { text: cell.textContent, ratio: ratio(s.color, s.backgroundColor) };
      });
      return { pairs: pairsResult, heatmap };
    });
    results.push({ theme, contrast });
    for (const pair of contrast.pairs)
      assert(pair.ratio >= 4.5, `${theme}: ${pair.text}/${pair.surface} contrast ${pair.ratio}`);
    for (const cell of contrast.heatmap)
      assert(cell.ratio >= 4.5, `${theme}: attention ${cell.text} contrast ${cell.ratio}`);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('tab', { name: 'Learn', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await page.screenshot({ path: `${output}/${theme}-mobile-inspector.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await page.screenshot({ path: `${output}/${theme}-mobile-block.png` });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.screenshot({ path: `${output}/${theme}-small-mobile-block.png` });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    `${output}/visual-audit.json`,
    JSON.stringify({ date: new Date().toISOString(), results, errors }, null, 2),
  );
  await browser.close();
}
console.log(
  `Native 100% zoom: ${results.filter((r) => r.width).length} layouts checked; theme contrast and scene heading separation passed.`,
);
