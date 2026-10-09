import { test, expect, type Page } from '@playwright/test';

const root = (page: Page, id: string) => page.locator(`.workspace-nav [data-workspace="${id}"]`);
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
      (window as any).__workspaceScene = this;
      original.call(this, value);
    };
  }, path);
  await page.locator('#journey-mode').selectOption('AUTO');
  await page.evaluate(() => {
    (window as any).__originalCanvas = document.querySelector('#viewport canvas');
  });
}
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__workspaceScene;
    return {
      camera: [...s.camera.position.toArray(), ...s.controls.target.toArray(), s.camera.zoom].map(
        (n: number) => n.toFixed(8),
      ),
      sameRenderer: s.renderer.domElement === (window as any).__originalCanvas,
      selected: s.selected,
      scene: s.sceneId,
      stage: (document.getElementById('timeline') as HTMLInputElement).value,
      journey: { ...document.querySelector<HTMLElement>('.playback')!.dataset },
      intent: document.getElementById('play')!.getAttribute('aria-label'),
      source: (document.getElementById('mode') as HTMLSelectElement).value,
      cards: [...document.querySelectorAll('.world-callout')].map((e) => [
        e.getAttribute('data-subject'),
        e.getAttribute('data-role'),
      ]),
    };
  });

test('inactive host survives root navigation; scaffolds own no replay and keyboard cannot seek hidden Demo', async ({
  page,
}) => {
  await prepare(page);
  await expect(root(page, 'DEMO')).toHaveAttribute('aria-current', 'page');
  await page.locator('#scenario').selectOption('tools');
  await page.locator('.object-label[data-concept="router"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.world-callout[data-subject="router"]')).toHaveCount(1);
  await page.clock.runFor(1800);
  const before = await snapshot(page);
  await root(page, 'EXPLORE').click();
  await expect(page.locator('#workspace-title')).toHaveText('Explore');
  await expect(page.locator('#demo-host')).toHaveAttribute('inert', '');
  await expect(page.locator('.playback')).toBeHidden();
  await page.locator('#workspace-title').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  await page.keyboard.press('/');
  await expect(page.locator('#search-dialog')).not.toBeVisible();
  await root(page, 'LIVE').click();
  await expect(page.locator('#workspace-title')).toHaveText('Live Lab');
  await page.getByRole('button', { name: 'Return to Demo Lab' }).click();
  await expect(root(page, 'DEMO')).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  expect((await snapshot(page)).sameRenderer).toBe(true);
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  await expect(page.locator('#scenario')).toHaveValue('tools');
});

for (const mode of ['AUTO', 'MANUAL']) {
  test(`${mode} incomplete navigation guard preserves state, including detachment and blockers`, async ({
    page,
  }) => {
    await prepare(page);
    await page.locator('#journey-mode').selectOption(mode);
    await page.locator('#start-tour').click();
    await page.clock.runFor(2500);
    for (const state of ['attached', 'paused', 'detached', 'settings', 'appearance']) {
      if (state === 'paused' && mode === 'AUTO') await page.locator('#play').click();
      if (state === 'detached') {
        await page.mouse.move(10, 500);
        await page.mouse.wheel(0, 100);
        await page.clock.runFor(1200);
      }
      if (state === 'settings') await page.locator('#settings-open').click();
      if (state === 'appearance') {
        await page.keyboard.press('Escape');
        await page.locator('#appearance-open').click();
      }
      const before = await snapshot(page);
      // Modal top-layer prevents physical background clicks; exercise the same guard directly.
      await root(page, 'EXPLORE').evaluate((b: HTMLButtonElement) => b.click());
      await expect(root(page, 'DEMO')).toHaveAttribute('aria-current', 'page');
      expect(await snapshot(page)).toEqual(before);
      await expect(page.locator('#toast')).toContainText('Cross-workspace browsing');
    }
  });

  test(`${mode} completed presentation survives leaving and returning; replay remains intact`, async ({
    page,
  }) => {
    await prepare(page);
    await page.locator('#journey-mode').selectOption(mode);
    await page.locator('#start-tour').click();
    await page.locator('#timeline').fill('17');
    if (mode === 'AUTO') await page.clock.runFor(6200);
    else {
      await page.locator('#complete-tour').click();
      await page.clock.runFor(1800);
    }
    const before = await snapshot(page);
    await root(page, 'EXPLORE').click();
    await page.clock.runFor(1000);
    await root(page, 'LIVE').click();
    await root(page, 'DEMO').click();
    expect(await snapshot(page)).toEqual(before);
    await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
    await expect(page.locator('#stop-tour')).toBeHidden();
    await expect(page.locator('#play')).toBeDisabled();
    await page.getByRole('button', { name: 'Replay from start', exact: true }).click();
    await expect(page.locator('#timeline')).toHaveValue('0');
    await expect(page.locator('.playback')).toHaveAttribute('data-advancing', String(mode === 'AUTO'));
  });
}

test('guard does not reset elapsed teaching time; Reading Hold remains independent', async ({ page }) => {
  await prepare(page);
  await page.locator('#start-tour').click();
  await page.clock.runFor(3000);
  await page.locator('#data-tab').click();
  const before = await snapshot(page);
  await root(page, 'LIVE').click();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'READING_HOLD');
  await page.clock.runFor(4200);
  await page.clock.runFor(2500);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.clock.runFor(600);
  await expect(page.locator('#timeline')).toHaveValue('1');
});

test('request source stays independent; request finishes while stopped Demo is hidden', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    await ready;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'Still here' }, finish_reason: 'stop' }] }),
    });
  });
  await prepare(page);
  await page.locator('#settings-open').click();
  await page.locator('#provider-url').fill('https://example.test/v1');
  await page.locator('#provider-model').fill('test-model');
  await page.locator('#provider-stream').uncheck();
  await page.getByRole('button', { name: 'Save connection' }).click();
  await page.locator('#chat-tab').click();
  await page.getByLabel('Request source', { exact: true }).selectOption('live');
  await page.locator('#prompt').fill('Hello');
  await page.locator('#send').click();
  await expect(page.locator('#stop-request')).toBeVisible();
  await root(page, 'LIVE').click();
  await expect(root(page, 'DEMO')).toHaveAttribute('aria-current', 'page');
  await page.locator('#stop-tour').click();
  await root(page, 'LIVE').click();
  await expect(root(page, 'LIVE')).toHaveAttribute('aria-current', 'page');
  release();
  await expect(page.locator('#request-status')).toContainText('Response received');
  await root(page, 'DEMO').click();
  await expect(page.locator('#mode')).toHaveValue('live');
  await expect(page.locator('#messages')).toContainText('Still here');
  await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
});

for (const width of [1440, 820, 390])
  test(`root surfaces fit at ${width}px in light and dark`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    await expect(page.locator('#viewport canvas')).toBeVisible();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('#theme').click();
      for (const id of ['DEMO', 'EXPLORE', 'LIVE']) {
        await root(page, id).click();
        await expect(root(page, id)).toHaveAttribute('aria-current', 'page');
        for (const other of ['EXPLORE', 'DEMO', 'LIVE']) {
          const box = await root(page, other).boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
        await page.screenshot({ path: `artifacts/v4/part1-${width}-${theme}-${id}.png` });
      }
    }
  });
