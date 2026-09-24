import { chromium } from '@playwright/test';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [],
  external = [],
  warnings = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
});
page.on('request', (request) => {
  if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('data:'))
    external.push(request.url());
});
// Count actual draw calls, rather than treating requestAnimationFrame as rendered frames.
await page.addInitScript(() => {
  window.__drawCalls = 0;
  for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const original = WebGL2RenderingContext.prototype[method];
    WebGL2RenderingContext.prototype[method] = function (...args) {
      window.__drawCalls++;
      return original.apply(this, args);
    };
  }
});
const start = Date.now();
// Even an explicit authoring query must not expose development controls in a build.
for (const file of await readdir('dist/assets')) {
  if (/\.(js|css)$/.test(file))
    assert(
      !(await readFile(`dist/assets/${file}`, 'utf8')).includes('framing-calibration'),
      'Calibration UI leaked into production assets',
    );
}
await page.goto('http://127.0.0.1:4173/?calibrate=1');
await page.locator('#viewport canvas').waitFor();
await page.evaluate(() => document.fonts.ready);
await page.locator('.object-label').first().waitFor();
assert.equal(await page.locator('#framing-calibration').count(), 0);
const readyMs = Date.now() - start;
await page.screenshot({ path: 'artifacts/final-overview.png' });
const intervalCount = async () =>
  page.evaluate(async () => {
    const start = window.__drawCalls;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return window.__drawCalls - start;
  });
const idleDrawCalls = await intervalCount();
await page.getByRole('button', { name: 'Start journey', exact: true }).click();
const playbackDrawCalls = await intervalCount();
await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
const rendering = await page.evaluate(() => {
  const canvas = document.querySelector('#viewport canvas'),
    gl = canvas.getContext('webgl2'),
    extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'not exposed',
    backingWidth: canvas.width,
    cssWidth: canvas.clientWidth,
    pixelRatio: devicePixelRatio,
  };
});
for (const [label, name] of [
  ['Hardware', 'hardware'],
  ['Model', 'model'],
  ['Block', 'block'],
]) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.screenshot({ path: `artifacts/final-${name}.png` });
}
await page.locator('#explode').fill('100');
await page.screenshot({ path: 'artifacts/final-block-exploded.png' });
await page.locator('#explode').fill('0');
await page.screenshot({ path: 'artifacts/final-block-assembled.png' });
for (const [scenario, stage] of [
  ['tools', 'MCP client & server'],
  ['vision', 'Visual patches & encoder'],
  ['diffusion', 'Iterative refinement'],
]) {
  await page.getByLabel('Scenario', { exact: true }).selectOption(scenario);
  await page.locator('#stages [data-stage]').filter({ hasText: stage }).first().click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.screenshot({ path: `artifacts/final-${scenario}.png` });
}
await page.getByLabel('Scenario', { exact: true }).selectOption('text');
await page.getByRole('tab', { name: 'Learn', exact: true }).click();
await page.getByRole('button', { name: 'Toggle dark theme', exact: true }).click();
await page.screenshot({ path: 'artifacts/final-dark.png' });
await page.getByRole('button', { name: 'Toggle light theme', exact: true }).click();
const layout = [];
for (const [name, width, height] of [
  ['laptop', 1280, 720],
  ['tablet', 1024, 768],
  ['tablet-portrait', 820, 1180],
  ['small-laptop', 900, 700],
  ['mobile', 390, 844],
  ['small-mobile', 360, 640],
]) {
  await page.setViewportSize({ width, height });
  await page.screenshot({ path: `artifacts/final-${name}.png` });
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.equal(dimensions.width, dimensions.viewport, `${name}: horizontal overflow`);
  layout.push({ name, width, height, horizontalOverflow: false });
}
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Inspector', exact: true }).click();
await page.screenshot({ path: 'artifacts/final-mobile-inspector.png' });
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1440, height: 960 });
await page.getByRole('button', { name: 'Settings' }).click();
await page.screenshot({ path: 'artifacts/final-settings.png' });
await page.keyboard.press('Escape');
// Forward Journey-row jumps above now intentionally restore guidance. Establish
// a fresh exploration detour before checking request/attachment independence.
await page.getByRole('button', { name: 'Hardware', exact: true }).click();
await page.getByRole('tab', { name: 'Chat', exact: true }).click();
await page.getByRole('textbox', { name: 'Your message' }).fill('Why is the sky blue?');
await page.getByRole('button', { name: 'Run demo', exact: true }).click();
// Earlier manual scene exploration detached guidance. Running a request must
// not silently reclaim that camera; use the canonical recovery action.
assert.equal(await page.locator('.playback').getAttribute('data-advancing'), 'false');
await page.getByRole('button', { name: 'Resume focus', exact: true }).click();
await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
await page.screenshot({ path: 'artifacts/final-chat.png' });
assert.equal(idleDrawCalls, 0, 'A static, settled atlas should not redraw');
assert(playbackDrawCalls > 0, 'Teaching playback should draw the travelling request');
assert.deepEqual(errors, []);
assert.deepEqual(warnings, []);
assert.deepEqual(external, []);
const result = {
  date: new Date().toISOString(),
  browser: await browser.version(),
  readyMs,
  calibrationUiAbsent: true,
  idleDrawCallsPer500ms: idleDrawCalls,
  playbackDrawCallsPer500ms: playbackDrawCalls,
  rendering,
  layout,
  errors,
  warnings,
  externalRequests: external,
};
await writeFile('artifacts/preview-verification.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
