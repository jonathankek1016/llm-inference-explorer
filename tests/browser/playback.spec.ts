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

test('completed Auto offers Replay from start without changing restart or final-stage ownership', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#start-tour').click();
  await page.locator('#timeline').fill('17');
  await expect(page.locator('#replay')).toHaveAttribute('aria-label', 'Replay journey');
  await page.locator('#play').click();
  await expect(page.locator('#replay')).not.toContainText('Replay from start');
  await page.locator('#play').click();
  await page.clock.runFor(1800);
  const finalCamera = await readCamera(page);
  const playBox = await page.locator('#play').boundingBox();
  await page.clock.runFor(4400);
  await stage(page, 17);
  await advancing(page, false);
  await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
  await expect(page.locator('#stop-tour')).toBeHidden();
  await expect(page.locator('#start-tour')).toBeHidden();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play')).toBeDisabled();
  expect(await page.locator('#play').boundingBox()).toEqual(playBox);
  expect(await readCamera(page)).toEqual(finalCamera);
  // Mouse, native programmatic activation, synthetic click and the global
  // keyboard shortcut must all leave completion and playback intent untouched.
  await page.mouse.click(playBox!.x + playBox!.width / 2, playBox!.y + playBox!.height / 2);
  await page.locator('#play').evaluate((button: HTMLButtonElement) => {
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.locator('#timeline').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#play')).not.toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Space');
  await page.clock.runFor(300);
  await stage(page, 17);
  await advancing(page, false);
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play journey');
  await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'true');
  await expect(page.locator('.world-callout[data-role="guided"]')).toHaveAttribute(
    'data-subject',
    'response',
  );
  await expect(page.getByRole('button', { name: 'Replay from start', exact: true })).toBeVisible();
  await expect(page.locator('#replay')).toHaveText('Replay from start');
  await page.locator('.playback').screenshot({ path: 'artifacts/v3.1/part3-completed-light.png' });
  await page.locator('#theme').click();
  await page.locator('.playback').screenshot({ path: 'artifacts/v3.1/part3-completed-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Replay from start', exact: true }).click();
  await stage(page, 0);
  await advancing(page, true);
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#stop-tour')).toBeVisible();
  await expect(page.locator('#journey-mode')).toHaveValue('AUTO');
  await expect(page.locator('#replay')).toHaveAttribute('aria-label', 'Replay journey');
  await page.locator('#timeline').fill('17');
  await page.clock.runFor(6200);
  await expect(page.locator('#replay')).toHaveAttribute('aria-label', 'Replay from start');
  await page.locator('#previous').click();
  await expect(page.locator('#replay')).toHaveAttribute('aria-label', 'Replay journey');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#stop-tour')).toBeVisible();
});

test('explicit Stop during the final Auto stage remains free exploration, not completion', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#start-tour').click();
  await page.locator('#timeline').fill('17');
  await page.clock.runFor(1800);
  await expect(page.locator('#stop-tour')).toBeVisible();
  await page.locator('#stop-tour').click();
  await page.clock.runFor(6500);
  await stage(page, 17);
  await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
  await expect(page.locator('#start-tour')).toBeVisible();
  await expect(page.locator('#play')).toBeDisabled();
  await expect(page.locator('.world-callout[data-role="guided"]')).toHaveCount(0);
  await expect(page.locator('#replay')).not.toContainText('Replay from start');
});

async function timelinePoint(page: Page, position: number) {
  return page.locator('#timeline').evaluate((input: HTMLInputElement, position) => {
    const rect = input.getBoundingClientRect();
    const thumb = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.625;
    return {
      x: rect.left + thumb / 2 + (position / Number(input.max)) * (rect.width - thumb),
      y: rect.y + rect.height / 2,
    };
  }, position);
}

test('timeline track clicks snap to nearest stages, preserve boundaries and native keyboard navigation', async ({
  page,
}) => {
  await prepare(page);
  await mode(page, 'MANUAL');
  await page.locator('#start-tour').click();
  for (const [position, expected] of [
    [17, 17],
    [0, 0],
    [2.49, 2],
    [2.51, 3],
    [8.49, 8],
    [8.51, 9],
    [16.7, 17],
    [0.2, 0],
  ]) {
    const point = await timelinePoint(page, position);
    // Click off the thin painted line, within its larger hit area.
    await page.mouse.click(point.x, point.y + 5);
    await stage(page, expected);
    await expect(page.locator('.playback')).toHaveAttribute('data-journey-mode', 'MANUAL');
    await advancing(page, false);
  }
  await page.locator('#timeline').focus();
  await page.keyboard.press('ArrowRight');
  await stage(page, 1);
  await page.keyboard.press('End');
  await stage(page, 17);
  await expect(page.locator('#stop-tour')).toBeVisible();
  await expect(page.locator('#guidance-status')).toContainText('Manual');
  await expect(page.locator('#next')).toBeDisabled();
  await page.keyboard.press('Home');
  await stage(page, 0);
});

test('track click and native thumb drag use equivalent navigation across journey states', async ({
  page,
}) => {
  await prepare(page);
  for (const state of ['inactive', 'manual', 'auto', 'paused', 'detached']) {
    await page.locator('#replay').click();
    if (state === 'inactive') await page.locator('#stop-tour').click();
    if (state === 'manual') await mode(page, 'MANUAL');
    else await mode(page, 'AUTO');
    if (state === 'paused') await page.locator('#play').click();
    if (state === 'detached') {
      await page.mouse.move(12, 400);
      await page.mouse.wheel(0, 120);
      await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
    }
    const snapshot = () =>
      page.evaluate(() => ({
        journey: { ...(document.querySelector('.playback') as HTMLElement).dataset },
        play: document.querySelector('#play')!.getAttribute('aria-label'),
        subject: document.querySelector('.world-callout[data-role="guided"]')?.getAttribute('data-subject'),
        selected: document.querySelector('#inspector-header h2')?.textContent,
      }));
    const destination = await timelinePoint(page, 2);
    await page.mouse.click(destination.x, destination.y);
    await stage(page, 2);
    const clicked = await snapshot();
    await page.locator('#timeline').fill('0');
    const thumb = await timelinePoint(page, 0);
    await page.mouse.move(thumb.x, thumb.y);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 8 });
    await page.mouse.up();
    await stage(page, 2);
    expect(await snapshot()).toEqual(clicked);
    // Native drag remains available immediately after a track click, too.
    const end = await timelinePoint(page, 3);
    await page.mouse.move(destination.x, destination.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    await stage(page, 3);
  }
});

test('track click and drag give the destination its full teaching interval', async ({ page }) => {
  await prepare(page);
  await page.locator('#timeline').evaluate((input) => {
    input.addEventListener('input', () => (window as any).__timelineInputs++);
  });
  for (const gesture of ['click', 'drag']) {
    await page.locator('#replay').click();
    await page.clock.runFor(2000);
    const destination = await timelinePoint(page, 1);
    await page.evaluate(() => {
      (window as any).__timelineInputs = 0;
    });
    if (gesture === 'click') await page.mouse.click(destination.x, destination.y);
    else {
      const thumb = await timelinePoint(page, 0);
      await page.mouse.move(thumb.x, thumb.y);
      await page.mouse.down();
      await page.mouse.move(destination.x, destination.y);
      await page.mouse.up();
    }
    await stage(page, 1);
    expect(await page.evaluate(() => (window as any).__timelineInputs)).toBe(1);
    // Router gets its entire authored 6 seconds, independent of Device's 2s.
    await page.clock.runFor(5700);
    await stage(page, 1);
    await page.clock.runFor(500);
    await stage(page, 2);
  }
});

test('Manual navigation, modes, Auto intent and speed share one current stage without reframing', async ({
  page,
}) => {
  // Several virtual teaching intervals still render frames on the host GPU.
  test.setTimeout(60000);
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
