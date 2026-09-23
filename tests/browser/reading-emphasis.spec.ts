import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page, start = true) {
  const response = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const path = (await response).url();
  await page.clock.install();
  await page.evaluate(async (path) => {
    const { AtlasScene } = await import(/* @vite-ignore */ path);
    const original = AtlasScene.prototype.setGuidedEmphasis;
    AtlasScene.prototype.setGuidedEmphasis = function (...args: unknown[]) {
      (window as any).__readingScene = this;
      return original.apply(this, args);
    };
  }, path);
  if (start) {
    await page.getByLabel('Journey mode', { exact: true }).selectOption('MANUAL');
    await page.getByRole('button', { name: 'Start journey', exact: true }).click();
    await page.clock.runFor(2000);
  }
}
async function camera(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__readingScene;
    return {
      position: s.camera.position.toArray(),
      target: s.controls.target.toArray(),
      zoom: s.camera.zoom,
      projection: s.camera.projectionMatrix.toArray(),
      orthographic: s.camera.isOrthographicCamera,
    };
  });
}
async function effects(page: Page) {
  return page.evaluate(() =>
    (window as any).__readingScene.emphasis.effects.map((e: any) => ({
      owner: e.owner,
      amount: e.amount.value,
      opacity: e.material.opacity,
      uuid: e.material.uuid,
    })),
  );
}
const hold = (page: Page, value = true) =>
  expect(page.locator('.playback')).toHaveAttribute(
    'data-suspensions',
    value ? /READING_HOLD/ : /^(?!.*READING_HOLD)/,
  );
const tracking = (page: Page) =>
  expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
async function wheel(page: Page) {
  await page.locator('#inspector-body').hover();
  await page.mouse.wheel(0, 120);
  await hold(page);
}
const auto = (page: Page) => page.getByLabel('Journey mode', { exact: true }).selectOption('AUTO');

test('current-subject scroll holds remaining Auto time without changing stage, attachment or camera', async ({
  page,
}) => {
  await prepare(page);
  await auto(page);
  await page.clock.runFor(900);
  const before = await camera(page);
  await wheel(page);
  await tracking(page);
  await expect(page.locator('#resume-focus')).toBeHidden();
  await page.clock.runFor(3000);
  await wheel(page);
  await page.clock.runFor(3000);
  await expect(page.locator('#timeline')).toHaveValue('0');
  expect(await camera(page)).toEqual(before);
  await page.clock.runFor(1100);
  await hold(page, false);
  await page.clock.runFor(4700);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.clock.runFor(500);
  await expect(page.locator('#timeline')).toHaveValue('1');
});

test('tabs, deeper details, selection/copy, keyboard and guided callout use bounded reading holds, never hover', async ({
  page,
}) => {
  await prepare(page);
  await auto(page);
  await page.locator('#inspector-header').hover();
  await hold(page, false);
  for (const tab of ['data', 'sources', 'learn']) {
    await page.locator(`#${tab}-tab`).click();
    await hold(page);
    await tracking(page);
    await page.clock.runFor(1500);
  }
  await page.getByText('Stage overview', { exact: true }).click();
  await hold(page);
  await page.locator('#inspector-body > p').selectText();
  await page.keyboard.press('Control+c');
  await hold(page);
  await page.locator('#sources-tab').focus();
  await page.keyboard.press('Enter');
  await hold(page);
  await page.locator('#inspector-body').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await tracking(page);
  await page.clock.runFor(2000);
  await page.locator('.world-callout[data-role="guided"] .callout-inspect').click();
  await hold(page);
  await expect(page.locator('#inspector-panel')).toHaveAttribute('data-subject-role', 'current');
  await page.clock.runFor(4100);
  await hold(page, false);
  await tracking(page);
  await expect(page.locator('#timeline')).toHaveValue('0');
});

test('Settings removes only its blocker; reading expiry cannot clear explicit pause', async ({ page }) => {
  await prepare(page);
  await auto(page);
  await wheel(page);
  await page.locator('#settings-open').click();
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', /READING_HOLD.*SETTINGS/);
  await page.clock.runFor(1000);
  await page.keyboard.press('Escape');
  await hold(page);
  await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
  await page.clock.runFor(3100);
  await hold(page, false);
  await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
  await wheel(page);
  await page.clock.runFor(4200);
  await hold(page, false);
  await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
  await tracking(page);
});

test('related, search and world exploration still derail; clearing reading cannot reattach', async ({
  page,
}) => {
  await prepare(page);
  await auto(page);
  await wheel(page);
  await page.locator('#inspector-body .related [data-concept]').first().click();
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await hold(page, false);
  await page.clock.runFor(5000);
  await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
  await expect(page.locator('#inspector-panel')).toHaveAttribute('data-subject-role', 'exploration');
  await page.locator('#resume-focus').click();
  await page.clock.runFor(1700);
  await page.locator('#search-open').click();
  await page.locator('#search-input').fill('KV cache');
  await page.locator('[data-search-concept="cache"]').click();
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.locator('#resume-focus').click();
  await page.locator('.object-label[data-concept="router"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await expect(page.locator('#timeline')).toHaveValue('0');
});

test('Manual/inactive reading never starts Auto; closure and new stage clear stale holds without reframing', async ({
  page,
}) => {
  await prepare(page, false);
  await page.locator('#data-tab').click();
  await hold(page, false);
  await page.getByLabel('Journey mode', { exact: true }).selectOption('MANUAL');
  await page.getByRole('button', { name: 'Start journey', exact: true }).click();
  await page.clock.runFor(2000);
  await page.locator('#learn-tab').click();
  await hold(page, false);
  await page.clock.runFor(5000);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await tracking(page);
  await auto(page);
  // Mode switching changes only progression; let any remaining orbit damping settle.
  await page.clock.runFor(300);
  await wheel(page);
  const before = await camera(page);
  await page.locator('#collapse-inspector').click();
  await hold(page, false);
  await page.locator('#restore-inspector').click();
  expect(await camera(page)).toEqual(before);
  await wheel(page);
  await page.locator('#next').click();
  await hold(page, false);
  await expect(page.locator('#timeline')).toHaveValue('1');
  await page.clock.runFor(5000);
  await expect(page.locator('#timeline')).toHaveValue('1');
});

test('guided emphasis eases between subjects and restores neutral materials during exploration', async ({
  page,
}) => {
  await prepare(page);
  const initial = await effects(page);
  expect(initial.filter((e: any) => e.owner === 'device').every((e: any) => e.amount === 0)).toBe(true);
  expect(
    initial.filter((e: any) => e.owner === 'router').every((e: any) => e.amount === 1 && e.opacity === 1),
  ).toBe(true);
  await page.locator('#next').click();
  await page.clock.runFor(64);
  const middle = await effects(page);
  expect(middle.find((e: any) => e.owner === 'device').amount).toBeGreaterThan(0);
  expect(middle.find((e: any) => e.owner === 'device').amount).toBeLessThan(1);
  expect(middle.find((e: any) => e.owner === 'router').amount).toBeGreaterThan(0);
  await page.clock.runFor(1800);
  expect(
    (await effects(page)).filter((e: any) => e.owner === 'router').every((e: any) => e.amount === 0),
  ).toBe(true);
  await page.mouse.move(12, 350);
  await page.mouse.wheel(0, 120);
  await page.clock.runFor(1800);
  expect((await effects(page)).every((e: any) => e.amount === 0)).toBe(true);
  await page.locator('#resume-focus').click();
  await page.clock.runFor(1800);
  const restored = await effects(page);
  expect(restored.filter((e: any) => e.owner === 'device').every((e: any) => e.amount === 1)).toBe(true);
  expect(restored.map((e: any) => e.uuid)).toEqual(initial.map((e: any) => e.uuid));
  expect((await camera(page)).orthographic).toBe(true);
});

for (const theme of ['light', 'dark'])
  test(`${theme} emphasis and deeper reference visual review across scenes and palettes`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page);
    if (theme === 'dark') await page.locator('#theme').click();
    await page.locator('#appearance-open').click();
    await page.getByRole('radio', { name: 'Soft Lavender', exact: true }).check();
    await page.keyboard.press('Escape');
    for (const [name, index] of [
      ['overview', 0],
      ['hardware', 6],
      ['model', 11],
    ] as const) {
      await page.locator('#timeline').fill(String(index));
      await page.clock.runFor(2200);
      await page.screenshot({ path: `artifacts/part4/${theme}-${name}.png` });
      const before = await camera(page);
      for (const id of ['collapse-inspector', 'restore-inspector', 'collapse-journey', 'restore-journey'])
        await page.locator('#' + id).click();
      const after = await camera(page);
      expect(after.zoom).toBeCloseTo(before.zoom, 8);
      after.position.forEach((v: number, i: number) => expect(v).toBeCloseTo(before.position[i], 8));
      await page.locator('#sources-tab').click();
      await page.locator('#data-tab').click();
      await page.locator('#learn-tab').click();
    }
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    for (const id of ['attention', 'mlp']) {
      await page.locator(`.object-label[data-concept="${id}"]`).focus();
      await page.keyboard.press('Enter');
    }
    await page.clock.runFor(1800);
    await page.screenshot({ path: `artifacts/part4/${theme}-block-exploration.png` });
    expect((await effects(page)).every((e: any) => e.amount === 0)).toBe(true);
    await page.locator('#resume-focus').click();
    await page.clock.runFor(2200);
    await page.screenshot({ path: `artifacts/part4/${theme}-resume.png` });
    expect(errors).toEqual([]);
  });

test('an active Live stream continues while current-subject Reading Hold suspends education', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    const encoder = new TextEncoder();
    window.fetch = (input, init) => {
      if (!String(input).startsWith('https://example.test/')) return original(input, init);
      (window as any).__liveSignal = init?.signal;
      const frame = (text: string, finish: string | null = null) =>
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`,
        );
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(frame('First chunk. '));
              (window as any).__finishLive = () => {
                controller.enqueue(frame('Still streaming.', 'stop'));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              };
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    };
  });
  await prepare(page, false);
  await page.locator('#settings-open').click();
  await page.getByLabel('Base URL', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('Model identifier', { exact: true }).fill('fixture');
  await page.getByLabel('Request streaming', { exact: true }).check();
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Chat mode', { exact: true }).selectOption('live');
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('Keep this request running.');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('.message.assistant p')).toHaveText('First chunk.');
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toBeVisible();
  await page.clock.runFor(500);
  await wheel(page);
  const frozen = await camera(page);
  await hold(page);
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => (window as any).__liveSignal.aborted)).toBe(false);
  await page.evaluate(() => (window as any).__finishLive());
  await expect(page.locator('#request-status')).toContainText('Response received');
  await expect(page.locator('.message.assistant p')).toHaveText('First chunk. Still streaming.');
  expect(await camera(page)).toEqual(frozen);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.clock.runFor(3200);
  await hold(page, false);
  await page.clock.runFor(5600);
  await expect(page.locator('#timeline')).toHaveValue('1');
});
