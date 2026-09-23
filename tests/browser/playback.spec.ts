import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page) {
  const response = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const path = (await response).url();
  await page.clock.install();
  await page.evaluate(async (path) => {
    const { AtlasScene } = await import(/* @vite-ignore */ path);
    const original = AtlasScene.prototype.setPresentationSuspended;
    AtlasScene.prototype.setPresentationSuspended = function (value: boolean) {
      (window as any).__playbackScene = this;
      original.call(this, value);
    };
  }, path);
}
const mode = (page: Page, value: string) => page.locator('#journey-mode').selectOption(value);
const stage = (page: Page, index: number) => expect(page.locator('#timeline')).toHaveValue(String(index));
const advancing = (page: Page, value: boolean) =>
  expect(page.locator('.playback')).toHaveAttribute('data-advancing', String(value));
const readCamera = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__playbackScene;
    return {
      position: s.camera.position.toArray(),
      target: s.controls.target.toArray(),
      zoom: s.camera.zoom,
      orthographic: s.camera.isOrthographicCamera,
    };
  });

test('Manual navigation, modes, Auto intent and speed share one current stage without reframing', async ({
  page,
}) => {
  await prepare(page);
  await expect(page.locator('.playback #start-tour')).toBeVisible();
  await expect(page.locator('#play')).toBeDisabled();
  await mode(page, 'MANUAL');
  await page.locator('#start-tour').click();
  await page.clock.runFor(7000);
  await stage(page, 0);
  await page.locator('#next').click();
  await stage(page, 1);
  await page.locator('#previous').click();
  await stage(page, 0);
  await page.clock.runFor(1800);
  const camera = await readCamera(page);
  await mode(page, 'AUTO');
  expect(await readCamera(page)).toEqual(camera);
  await page.clock.runFor(2000);
  await mode(page, 'MANUAL');
  await page.clock.runFor(8000);
  await stage(page, 0);
  await mode(page, 'AUTO');
  await page.locator('#speed').selectOption('2');
  expect(await readCamera(page)).toEqual(camera);
  await page.clock.runFor(1800);
  await stage(page, 0);
  await page.clock.runFor(400);
  await stage(page, 1);
  await page.locator('#next').click();
  await stage(page, 2);
  await advancing(page, true);
  await page.locator('#play').click();
  await page.locator('#timeline').fill('11');
  await stage(page, 11);
  await expect(page.locator('#playback-position')).toHaveText('12 / 18');
  await page.clock.runFor(7000);
  await stage(page, 11);
  await page.locator('#play').click();
  await page.clock.runFor(4700);
  await stage(page, 11);
  await page.clock.runFor(500);
  await stage(page, 12);
  expect((await readCamera(page)).orthographic).toBe(true);
});

test('Play changes intent while held or detached; only Resume restores guidance and never erases Pause', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#start-tour').click();
  await page.clock.runFor(1800);
  await page.locator('#inspector-body').hover();
  await page.mouse.wheel(0, 100);
  await expect(page.locator('#guidance-status')).toContainText('Reading');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Pause journey');
  await page.locator('#play').click();
  await page.locator('#settings-open').click();
  await expect(page.locator('#guidance-status')).toContainText('Auto paused');
  await expect(page.locator('#guidance-status')).toContainText('Settings open');
  await page.clock.runFor(4500);
  await page.keyboard.press('Escape');
  await advancing(page, false);
  await page.mouse.move(12, 400);
  await page.mouse.wheel(0, 120);
  await page.clock.runFor(1800);
  const detachedCamera = await readCamera(page);
  await page.locator('#play').click();
  await advancing(page, false);
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  expect(await readCamera(page)).toEqual(detachedCamera);
  await page.locator('#play').click();
  await page.locator('#resume-focus').click();
  await advancing(page, false);
  await page.clock.runFor(7000);
  await stage(page, 0);
  await page.locator('#play').click();
  await page.clock.runFor(4000);
  await stage(page, 0);
  await page.clock.runFor(500);
  await stage(page, 1);
});

test('Stop clears guided ownership and emphasis, preserves exploration, and Start obeys the chosen mode', async ({
  page,
}) => {
  await prepare(page);
  await mode(page, 'MANUAL');
  await page.locator('#start-tour').click();
  await page.clock.runFor(1800);
  await page.locator('.object-label[data-concept="router"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.world-callout[data-role="exploratory"]')).toHaveCount(1);
  const before = await readCamera(page);
  await page.locator('#stop-tour').click();
  await expect(page.locator('.world-callout[data-role="guided"]')).toHaveCount(0);
  await expect(page.locator('.world-callout[data-role="exploratory"]')).toHaveCount(1);
  await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
  await expect(page.locator('#resume-focus')).toBeHidden();
  expect(await readCamera(page)).toEqual(before);
  await page.clock.runFor(1800);
  expect(
    await page.evaluate(() =>
      (window as any).__playbackScene.emphasis.effects.every((e: any) => e.amount.value === 0),
    ),
  ).toBe(true);
  await page.locator('#focus-selection').click();
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
  await page.locator('#start-tour').click();
  await expect(page.locator('#journey-mode')).toHaveValue('MANUAL');
  await advancing(page, false);
  await expect(page.locator('.world-callout[data-role="guided"]')).toHaveCount(1);
  await expect(page.locator('#follow, #fit-scene')).toHaveCount(0);
  await expect(page.locator('#resume-focus')).toHaveCount(1);
  await expect(page.locator('.viewport-toolbar button')).toHaveCount(3);
});

for (const theme of ['light', 'dark'])
  test(`${theme} Teaching Replay states and responsive toolbar visual review`, async ({ page }) => {
    test.setTimeout(90000);
    await prepare(page);
    if (theme === 'dark') await page.locator('#theme').click();
    for (const width of [1920, 1280, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
      await mode(page, 'MANUAL');
      await page.locator('#replay').click();
      await page.clock.runFor(1800);
      await page.screenshot({ path: `artifacts/part5/${theme}-${width}-manual.png` });
      await mode(page, 'AUTO');
      await page.clock.runFor(500);
      await page.locator('#play').click();
      await page.screenshot({ path: `artifacts/part5/${theme}-${width}-paused.png` });
      await page.mouse.move(6, 330);
      await page.mouse.wheel(0, 120);
      await page.clock.runFor(500);
      await page.screenshot({ path: `artifacts/part5/${theme}-${width}-detached.png` });
      await page.locator('#resume-focus').click();
      await advancing(page, false);
      await page.clock.runFor(1800);
      if (width > 980) {
        const before = await readCamera(page);
        for (const id of ['collapse-inspector', 'collapse-journey', 'restore-inspector', 'restore-journey'])
          await page.locator('#' + id).click();
        expect(await readCamera(page)).toEqual(before);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const panel = await page.locator('.playback').boundingBox();
      for (const id of ['journey-mode', 'play', 'previous', 'next', 'timeline', 'speed', 'stop-tour']) {
        const rect = await page.locator('#' + id).boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(panel!.x);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
      }
      await page.locator('#stop-tour').click();
    }
  });
