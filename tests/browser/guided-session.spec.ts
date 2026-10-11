import { test, expect, type Page } from '@playwright/test';

const root = (page: Page, id: string) => page.locator(`.workspace-nav [data-workspace="${id}"]`);
async function prepare(page: Page) {
  const module = page.waitForResponse((r) => /\/src\/guided-session\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.clock.install();
  // Capture the real manager through its public API, without a production test hook.
  await page.evaluate(
    async (path) => {
      const { GuidedSessions } = await import(/* @vite-ignore */ path);
      const original = GuidedSessions.prototype.admit;
      GuidedSessions.prototype.admit = function (...args: any[]) {
        (window as any).__sessions = this;
        return original.apply(this, args);
      };
    },
    (await module).url(),
  );
}

for (const mode of ['AUTO', 'MANUAL'])
  test(`${mode} parked session preserves Explore browsing and manual return requires local Resume`, async ({
    page,
  }) => {
    await prepare(page);
    await expect(page.locator('#global-session')).toBeHidden();
    await page.locator('#journey-mode').selectOption(mode);
    await page.locator('#start-tour').click();
    await page.locator('#timeline').fill('12'); // KV cache
    await page.clock.runFor(1500);
    const id = await page.locator('#app').getAttribute('data-guided-session');
    await root(page, 'EXPLORE').click();
    await expect(page.locator('#global-session-label')).toContainText('Demo Lab · Session parked');
    await expect(page.locator('.playback')).toBeHidden();
    await expect(page.locator('#demo-host')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#explore-workspace canvas')).toBeVisible();
    await expect(page.locator('#explore-workspace .world-callout[data-role="guided"]')).toHaveCount(0);
    await page.locator('#search-open').click();
    await page.locator('#search-input').fill('KV cache');
    await page.keyboard.press('Enter');
    await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'cache');
    await page.clock.runFor(15000);
    await expect(page.locator('#timeline')).toHaveValue('12');
    await root(page, 'DEMO').click();
    await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
    await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
    await expect(page.locator('#journey-mode')).toHaveValue(mode);
    await expect(page.locator('#app')).toHaveAttribute('data-guided-session', id!);
    await page.locator('#resume-focus').click();
    await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
    await expect(page.locator('.playback')).toHaveAttribute('data-advancing', String(mode === 'AUTO'));
    await root(page, 'EXPLORE').click();
    await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'cache');
    await page.locator('#global-session-end').click();
    await expect(page.locator('#global-session')).toBeHidden();
    await root(page, 'DEMO').click();
    await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
    await expect(page.locator('#timeline')).toHaveValue('12');
  });

test('global Return preserves explicit Pause and composable modal ownership', async ({ page }) => {
  await prepare(page);
  await page.locator('#start-tour').click();
  await page.clock.runFor(1500);
  await page.locator('#play').click();
  await page.locator('#settings-open').click();
  await page.locator('#appearance-open').evaluate((b: HTMLButtonElement) => b.click());
  const id = await page.locator('#app').getAttribute('data-guided-session');
  await root(page, 'EXPLORE').evaluate((b: HTMLButtonElement) => b.click());
  await page.locator('#global-session-return').evaluate((b: HTMLButtonElement) => b.click());
  await expect(root(page, 'DEMO')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'SETTINGS APPEARANCE');
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play journey');
  await page.getByRole('button', { name: 'Close appearance' }).click();
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'SETTINGS');
  await page.keyboard.press('Escape');
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', '');
  await page.clock.runFor(15000);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
  await expect(page.locator('#app')).toHaveAttribute('data-guided-session', id!);
});

test('reusable admission conflict offers Cancel, Return and End without starting the denied journey', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#start-tour').click();
  await page.locator('#stop-tour').click();
  // A test-only port represents a future lab. No fake lab or capability ships in the UI.
  await page.evaluate(() => {
    const manager = (window as any).__sessions;
    const owner = { workspace: 'LIVE', instanceId: 'test:other-lab', label: 'Other lab' };
    let incomplete = true;
    (window as any).__otherResumes = 0;
    manager.register(owner, {
      incomplete: () => incomplete,
      detach: () => {},
      resume: () => {
        (window as any).__otherResumes++;
      },
      end: () => {
        incomplete = false;
      },
    });
    manager.admit(owner);
  });
  await page.locator('#start-tour').click();
  await expect(page.locator('#session-conflict')).toBeVisible();
  await expect(page.locator('#session-conflict-cancel')).toBeFocused();
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
  await page.locator('#session-conflict-cancel').click();
  await page.locator('#replay').click();
  await page.locator('#session-conflict-return').click();
  await expect(root(page, 'LIVE')).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => (window as any).__otherResumes)).toBe(1);
  await root(page, 'DEMO').click();
  await page.locator('#replay').click();
  await page.screenshot({ path: 'artifacts/v4/part3-admission-light.png' });
  await page.locator('#session-conflict-cancel').click();
  await page.locator('#theme').click();
  await page.locator('#start-tour').click();
  await page.screenshot({ path: 'artifacts/v4/part3-admission-dark.png' });
  await page.locator('#session-conflict-end').click();
  await expect(page.locator('#global-session')).toBeHidden();
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
  await page.locator('#start-tour').click();
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'true');
  await expect(page.locator('#session-conflict')).not.toBeVisible();
});

test('completed replay, navigation and request acquisition cannot overwrite a different reservation', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#journey-mode').selectOption('MANUAL');
  await page.locator('#start-tour').click();
  await page.locator('#timeline').fill('17');
  await page.locator('#complete-tour').click();
  await expect(page.locator('#global-session')).toBeHidden();
  await page.evaluate(() => {
    const manager = (window as any).__sessions;
    const owner = { workspace: 'LIVE', instanceId: 'test:future', label: 'Other lab' };
    manager.register(owner, { incomplete: () => true, detach() {}, resume() {}, end() {} });
    manager.admit(owner);
  });
  for (const action of ['replay', 'timeline', 'scenario', 'route', 'request']) {
    if (action === 'replay') await page.locator('#replay').click();
    if (action === 'timeline') await page.locator('#timeline').fill('5');
    if (action === 'scenario') await page.locator('#scenario').selectOption('tools');
    if (action === 'route') await page.locator('#route').selectOption('local');
    if (action === 'request') {
      await page.locator('#chat-tab').click();
      await page.locator('#prompt').fill('Keep this prompt');
      await page.locator('#send').click();
      await expect(page.locator('#prompt')).toHaveValue('Keep this prompt');
      await expect(page.locator('#messages .message')).toHaveCount(0);
    }
    await expect(page.locator('#session-conflict')).toBeVisible();
    await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
    await expect(page.locator('#timeline')).toHaveValue('17');
    await expect(page.locator('#scenario')).toHaveValue('text');
    await expect(page.locator('#route')).toHaveValue('remote');
    await page.locator('#session-conflict-cancel').click();
  }
});

test('a live request keeps running across parking, global Return and educational completion', async ({
  page,
}) => {
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    await response;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: 'Preserved result' }, finish_reason: 'stop' }],
      }),
    });
  });
  await prepare(page);
  await page.locator('#settings-open').click();
  await page.locator('#provider-url').fill('https://example.test/v1');
  await page.locator('#provider-model').fill('test-model');
  await page.locator('#provider-stream').uncheck();
  await page.getByRole('button', { name: 'Save connection' }).click();
  await page.locator('#journey-mode').selectOption('MANUAL');
  await page.locator('#chat-tab').click();
  await page.locator('#mode').selectOption('live');
  await page.locator('#prompt').fill('Hello');
  await page.locator('#send').click();
  await expect(page.locator('#global-session')).toBeVisible();
  await expect(page.locator('#stop-request')).toBeVisible();
  await root(page, 'EXPLORE').click();
  await page.clock.runFor(1000);
  await page.locator('#global-session-return').click();
  await expect(page.locator('#stop-request')).toBeVisible();
  await page.locator('#timeline').fill('17');
  await page.locator('#complete-tour').click();
  await expect(page.locator('#global-session')).toBeHidden();
  await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
  await expect(page.locator('#stop-request')).toBeVisible();
  await root(page, 'LIVE').click();
  release();
  await expect(page.locator('#request-status')).toContainText('Response received');
  await root(page, 'DEMO').click();
  await expect(page.locator('#messages')).toContainText('Preserved result');
  await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
});

for (const width of [1440, 390])
  test(`global controls have readable contrast and fit at ${width}px in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await prepare(page);
    await page.locator('#start-tour').click();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('#theme').click();
      for (const workspace of ['DEMO', 'EXPLORE', 'LIVE']) {
        await root(page, workspace).click();
        const box = await page.locator('#global-session').boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        for (const button of await page.locator('#global-session button:visible').all())
          await expect(button).toBeInViewport();
        const contrast = await page.locator('#global-session').evaluate((element) => {
          const style = getComputedStyle(element);
          const luminance = (value: string) => {
            const rgb = value
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((n) => {
                const s = n / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const a = luminance(style.color),
            b = luminance(style.backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({ path: `artifacts/v4/part3-${width}-${theme}-${workspace}.png` });
      }
    }
  });
