import { test, expect, type Page } from '@playwright/test';

// Observe the actual renderer in the browser without shipping a debug API.
// All state changes below still go through the real controls and UI.
async function prepare(page: Page) {
  const sceneResponse = page.waitForResponse((response) => /\/src\/scene\.ts(?:\?|$)/.test(response.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const modulePath = (await sceneResponse).url();
  await page.clock.install();
  await page.evaluate(async (modulePath) => {
    const { AtlasScene } = await import(/* @vite-ignore */ modulePath);
    const original = AtlasScene.prototype.focusJourneySubject;
    AtlasScene.prototype.focusJourneySubject = function (...args: unknown[]) {
      const applied = original.apply(this, args);
      const subject = args[0];
      (window as any).__cameraRead = () => ({
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
        zoom: this.camera.zoom,
        projection: this.camera.projectionMatrix.toArray(),
        scene: this.sceneId,
        subject,
        applied,
        pending: !!this.panTarget,
      });
      return applied;
    };
  }, modulePath);
  await page.getByLabel('Journey mode', { exact: true }).selectOption('MANUAL');
  await page.getByRole('button', { name: 'Start journey', exact: true }).click();
  await page.clock.runFor(1800);
}
const read = (page: Page) => page.evaluate(() => (window as any).__cameraRead());
function direction(camera: any) {
  const offset = camera.position.map((v: number, i: number) => v - camera.target[i]);
  const length = Math.hypot(...offset);
  return offset.map((v: number) => v / length);
}
function near(actual: number[], expected: number[], digits = 2) {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));
}
async function orbit(page: Page) {
  await page.mouse.move(12, 400);
  await page.mouse.down();
  await page.mouse.move(35, 455, { steps: 8 });
  await page.mouse.up();
}
const resume = (page: Page) => page.getByRole('button', { name: 'Resume focus', exact: true }).click();

test('same-scene guided motion is eased, preserves orbit, and focuses Next and Previous automatically', async ({
  page,
}) => {
  await prepare(page);
  near((await read(page)).target, [-6, 0.8, 2]);
  await orbit(page);
  await page.clock.runFor(1600);
  const before = await read(page);
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.getByRole('button', { name: 'Next stage', exact: true }).click();
  const immediate = await read(page);
  near(immediate.target, before.target);
  await page.clock.runFor(160);
  const first = await read(page);
  await page.clock.runFor(160);
  const second = await read(page);
  expect(first.target[0]).toBeGreaterThan(before.target[0]);
  expect(first.target[0]).toBeLessThan(-3);
  expect(first.target[0] - before.target[0]).toBeGreaterThan(second.target[0] - first.target[0]);
  // Allow the existing OrbitControls damping tail (well below 0.01 degrees).
  near(direction(first), direction(before), 4);
  await page.clock.runFor(1600);
  near((await read(page)).target, [-3, 0.8, 0]);
  near(direction(await read(page)), direction(before), 4);
  await page.getByRole('button', { name: 'Previous stage', exact: true }).click();
  // Orbit while the focus transition itself is running must not cancel it.
  await orbit(page);
  await page.clock.runFor(1800);
  near((await read(page)).target, [-6, 0.8, 2]);
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
});

test('guided zoom eases; manual zoom cancels it and Resume restores the current official framing', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#timeline').fill('3');
  const start = await read(page);
  await page.clock.runFor(160);
  const first = await read(page);
  await page.clock.runFor(160);
  const second = await read(page);
  expect(first.zoom).toBeLessThan(start.zoom);
  expect(first.zoom).toBeGreaterThan(1.35);
  expect(start.zoom - first.zoom).toBeGreaterThan(first.zoom - second.zoom);
  await page.mouse.move(12, 500);
  await page.mouse.wheel(0, -160);
  const manual = await read(page);
  await page.clock.runFor(1800);
  expect((await read(page)).zoom).toBe(manual.zoom);
  near((await read(page)).target, manual.target, 6);
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await expect(page.locator('#timeline')).toHaveValue('3');
  await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('MANUAL');
  await resume(page);
  await page.clock.runFor(1800);
  near((await read(page)).target, [5, 1.4, 0]);
  expect((await read(page)).zoom).toBeCloseTo(1.35, 3);
  await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
  await page.screenshot({ path: 'artifacts/v3-part2-guided-light.png' });
  await page.getByRole('button', { name: 'Toggle dark theme', exact: true }).click();
  await page.mouse.move(12, 500);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(35, 570, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.clock.runFor(1600);
  const panned = await read(page);
  expect(panned.target).not.toEqual(manual.target);
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.screenshot({ path: 'artifacts/v3-part2-detached-dark.png' });
  // Explicit navigation while detached changes the official subject, not recovery's old target.
  await page.getByRole('button', { name: 'Previous stage', exact: true }).click();
  near((await read(page)).target, panned.target);
  await resume(page);
  await page.clock.runFor(1800);
  near((await read(page)).target, [0, 0.8, -2]);
  expect((await read(page)).zoom).toBeCloseTo(1.65, 3);
  await expect(page.locator('#inspector-header h2')).toHaveText('Internet backbone');
});

test('panel changes preserve camera; free Focus Selection and cross-scene Resume retain separate subjects', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#timeline').fill('6');
  await page.clock.runFor(1800);
  const official = await read(page);
  expect(official.scene).toBe('compute');
  expect(official.subject).toBe('gpu');
  for (const panel of ['inspector', 'journey']) {
    await page.locator(`#collapse-${panel}`).click();
    await page.clock.runFor(300);
    expect(await read(page)).toEqual(official);
    await page.locator(`#restore-${panel}`).click();
    await page.clock.runFor(300);
    expect(await read(page)).toEqual(official);
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('#timeline')).toHaveValue('6');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.locator('.object-label[data-concept="internet"]').click();
  await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
  await page.clock.runFor(1800);
  near((await read(page)).target, [0, 0.8, -2]);
  await expect(page.locator('#inspector-header h2')).toHaveText('Internet backbone');
  await expect(page.locator('#timeline')).toHaveValue('6');
  await resume(page);
  await page.clock.runFor(1800);
  const restored = await read(page);
  expect(restored.scene).toBe('compute');
  near(restored.target, official.target);
  expect(restored.zoom).toBeCloseTo(official.zoom, 3);
  await expect(page.locator('#inspector-header h2')).toHaveText('GPU accelerator');
  await page.screenshot({ path: 'artifacts/v3-part2-guided-gpu.png' });
});

test('Auto follows official subjects, orbit stays attached, and only Resume recovers parked Auto', async ({
  page,
}) => {
  await prepare(page);
  await page.getByLabel('Journey mode', { exact: true }).selectOption('AUTO');
  await orbit(page);
  await page.clock.runFor(2700);
  expect((await read(page)).subject).toBe('router');
  await expect(page.locator('#timeline')).toHaveValue('1');
  await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'true');
  // Click another selectable object before its new framing obscures neighbours.
  await page.locator('.object-label[data-concept="device"]').click();
  await expect(page.locator('#inspector-header h2')).toHaveText('Your device');
  await expect(page.locator('#timeline')).toHaveValue('1');
  await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('AUTO');
  await expect(page.getByRole('button', { name: 'Play journey', exact: true })).toBeDisabled();
  await page.clock.runFor(3000);
  await expect(page.locator('#timeline')).toHaveValue('1');
  await resume(page);
  await expect(page.locator('#inspector-header h2')).toHaveText('Wi-Fi & router');
  await page.clock.runFor(2700);
  await expect(page.locator('#timeline')).toHaveValue('2');
  expect((await read(page)).subject).toBe('internet');
});

test('fresh free exploration does not activate guidance; reduced motion focuses without animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.mouse.move(12, 500);
  await page.mouse.wheel(0, -120);
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
  await expect(page.getByRole('button', { name: 'Resume focus', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page.locator('#scene-title')).toHaveText('Transformer block');
  await page.getByRole('button', { name: 'Play journey', exact: true }).click();
  await expect(page.locator('#scene-title')).toHaveText('The journey of an AI request');
  await expect(page.locator('#inspector-header h2')).toHaveText('Your device');
  await prepare(page);
  await page.getByRole('button', { name: 'Next stage', exact: true }).click();
  await page.clock.runFor(32);
  near((await read(page)).target, [-3, 0.8, 0], 6);
  expect((await read(page)).pending).toBe(false);
});

test('Resume remains visible and usable on tablet and mobile in both themes', async ({ page }) => {
  await prepare(page);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Toggle dark theme', exact: true }).click();
    for (const [width, height] of [
      [1024, 768],
      [390, 844],
      [360, 640],
    ]) {
      await page.setViewportSize({ width, height });
      await page.getByLabel('Follow journey', { exact: true }).uncheck();
      const button = page.getByRole('button', { name: 'Resume focus', exact: true });
      await expect(button).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: `artifacts/v3-part2-resume-${theme}-${width}.png` });
      await button.click();
      await page.clock.runFor(1800);
      await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
      await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
      near((await read(page)).target, [-6, 0.8, 2]);
    }
  }
});
