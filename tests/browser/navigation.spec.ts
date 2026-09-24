import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page, mode = 'MANUAL', start = true) {
  const response = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const path = (await response).url();
  await page.clock.install();
  await page.evaluate(async (path) => {
    const { AtlasScene } = await import(/* @vite-ignore */ path);
    const original = AtlasScene.prototype.setPresentationSuspended;
    AtlasScene.prototype.setPresentationSuspended = function (value: boolean) {
      (window as any).__navigationScene = this;
      original.call(this, value);
    };
    const focus = AtlasScene.prototype.focusJourneySubject;
    AtlasScene.prototype.focusJourneySubject = function (...args: unknown[]) {
      (window as any).__navigationFocus = args;
      return focus.apply(this, args);
    };
  }, path);
  await page.locator('#journey-mode').selectOption(mode);
  if (start) await page.locator('#start-tour').click();
  await page.clock.runFor(1800);
}
const row = (page: Page, index: number) => page.locator(`#stages [data-stage="${index}"]`).click();
const stage = (page: Page, index: number) => expect(page.locator('#timeline')).toHaveValue(String(index));
const attachment = (page: Page, value: string) =>
  expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', value);
const advancing = (page: Page, value: boolean) =>
  expect(page.locator('.playback')).toHaveAttribute('data-advancing', String(value));
const settle = (page: Page) => page.clock.runFor(1800);
const camera = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__navigationScene;
    return {
      scene: s.sceneId,
      position: s.camera.position.toArray(),
      target: s.controls.target.toArray(),
      zoom: s.camera.zoom,
      direction: s.camera.position.clone().sub(s.controls.target).normalize().toArray(),
      orthographic: s.camera.isOrthographicCamera,
      composition: s.composition.toArray(),
    };
  });
const focus = (page: Page) => page.evaluate(() => (window as any).__navigationFocus);
async function settings(page: Page, past: string, future: string) {
  await page.locator('#settings-open').click();
  await page.getByLabel('Earlier-stage jumps').selectOption(past);
  await page.getByLabel('Later-stage jumps').selectOption(future);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
}
async function search(page: Page, query: string, concept: string) {
  await page.locator('#search-open').click();
  await page.locator('#search-input').fill(query);
  await page.locator(`[data-search-concept="${concept}"]`).click();
}
async function object(page: Page, concept: string) {
  await page.locator(`.object-label[data-concept="${concept}"]`).focus();
  await page.keyboard.press('Enter');
}

for (const mode of ['MANUAL', 'AUTO'])
  test(`${mode}: default row matrix preserves comparison view and reattaches on a future row`, async ({
    page,
  }) => {
    await prepare(page, mode);
    await row(page, 3);
    await settle(page);
    await attachment(page, 'TRACKING');
    const before = await camera(page);
    await row(page, 1);
    await stage(page, 1);
    await attachment(page, 'DETACHED');
    await advancing(page, false);
    expect(await camera(page)).toEqual(before);
    await page.clock.runFor(7500);
    await stage(page, 1);
    await page.locator('#resume-focus').click();
    expect((await focus(page))[0]).toBe('router');
    await advancing(page, mode === 'AUTO');
    await row(page, 0);
    await attachment(page, 'DETACHED');
    await row(page, 4);
    await attachment(page, 'TRACKING');
    await stage(page, 4);
    expect((await focus(page)).slice(0, 2)).toEqual(['ingress', true]);
    expect((await camera(page)).scene).toBe('compute');
    await expect(page.locator('#journey-mode')).toHaveValue(mode);
  });

test('row overrides preserve view across scenes and Resume resolves the new official destination', async ({
  page,
}) => {
  await prepare(page);
  await row(page, 6);
  await settle(page);
  const before = await camera(page);
  await settings(page, 'guided', 'compare');
  expect(await camera(page)).toEqual(before);
  await row(page, 7);
  await attachment(page, 'DETACHED');
  await stage(page, 7);
  expect(await camera(page)).toEqual(before);
  await expect(page.locator('.world-callout[data-role="guided"]')).toBeHidden();
  await page.locator('#resume-focus').click();
  await settle(page);
  expect((await camera(page)).scene).toBe('model');
  expect((await focus(page)).slice(0, 2)).toEqual(['context', true]);
  await row(page, 6);
  await attachment(page, 'TRACKING');
  expect((await focus(page)).slice(0, 2)).toEqual(['gpu', true]);
  await expect(page.locator('#play')).toBeDisabled();
});

test('policy preferences persist without starting inactive guidance or requiring a connection', async ({
  page,
}) => {
  await prepare(page, 'AUTO', false);
  const before = await camera(page);
  await settings(page, 'guided', 'compare');
  expect(await camera(page)).toEqual(before);
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
  await page.clock.runFor(10000);
  await stage(page, 0);
  await page.reload();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.locator('#settings-open').click();
  await expect(page.getByLabel('Earlier-stage jumps')).toHaveValue('guided');
  await expect(page.getByLabel('Later-stage jumps')).toHaveValue('compare');
  await expect(page.getByLabel('Model identifier', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
});

for (const mode of ['MANUAL', 'AUTO'])
  test(`${mode}: cross-scene exploration preserves stage, callouts and pause intent through Settings and Resume`, async ({
    page,
  }) => {
    await prepare(page, mode);
    await page.locator('#scene-switcher [data-scene="block"]').click();
    await attachment(page, 'DETACHED');
    await stage(page, 0);
    await advancing(page, false);
    await object(page, 'attention');
    await expect(
      page.locator('.world-callout[data-role="exploratory"][data-subject="attention"]'),
    ).toBeVisible();
    await page.locator('#scene-switcher [data-scene="compute"]').click();
    await object(page, 'gpu');
    await stage(page, 0);
    await attachment(page, 'DETACHED');
    await settings(page, 'compare', 'guided');
    await attachment(page, 'DETACHED');
    if (mode === 'AUTO') await page.locator('#play').click();
    await page.locator('#resume-focus').click();
    await settle(page);
    expect((await camera(page)).scene).toBe('world');
    expect((await focus(page))[0]).toBe('device');
    await advancing(page, false);
    await expect(page.locator('.world-callout[data-role="guided"]')).toContainText('1 / 18');
    if (mode === 'AUTO') {
      await page.locator('#play').click();
      await advancing(page, true);
    }
    await page.locator('#scene-switcher [data-scene="block"]').click();
    await expect(
      page.locator('.world-callout[data-role="exploratory"][data-subject="attention"]'),
    ).toBeVisible();
    await expect(page.locator('#journey-mode')).toHaveValue(mode);
  });

test('current-subject search/object inspection stays attached; other concepts derail and clear stale reading', async ({
  page,
}) => {
  await prepare(page, 'AUTO');
  const before = await camera(page);
  await search(page, 'device', 'device');
  await attachment(page, 'TRACKING');
  expect(await camera(page)).toEqual(before);
  await object(page, 'device');
  await attachment(page, 'TRACKING');
  await page.locator('#inspector-body').hover();
  await page.mouse.wheel(0, 80);
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'READING_HOLD');
  await page.locator('#inspector-body [data-concept="router"]').click();
  await attachment(page, 'DETACHED');
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', '');
  await stage(page, 0);
  await search(page, 'attention', 'attention');
  await stage(page, 0);
  await attachment(page, 'DETACHED');
  await page.locator('#resume-focus').click();
  await settle(page);
  await object(page, 'internet');
  await attachment(page, 'DETACHED');
  await stage(page, 0);
});

test('exploration preserves remaining Auto time; row destinations get a full new duration', async ({
  page,
}) => {
  await prepare(page, 'AUTO'); // 1.8s of the 6s first stage.
  await row(page, 0); // Re-selecting the current row must not restart the timer.
  await search(page, 'gpu', 'gpu');
  await page.clock.runFor(10000);
  await search(page, 'attention', 'attention');
  await page.locator('#resume-focus').click();
  await page.clock.runFor(3800);
  await stage(page, 0);
  await page.clock.runFor(600);
  await stage(page, 1);
  await row(page, 0);
  await page.locator('#resume-focus').click();
  await page.clock.runFor(5600);
  await stage(page, 0);
  await page.clock.runFor(600);
  await stage(page, 1);
});

test('same-scene row guidance retains orbit; official boundaries and restart use canonical entry framing', async ({
  page,
}) => {
  await prepare(page);
  await page.mouse.move(12, 380);
  await page.mouse.down();
  await page.mouse.move(48, 450, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  const orbit = (await camera(page)).direction;
  await row(page, 2);
  expect((await focus(page))[1]).toBe(false);
  await settle(page);
  (await camera(page)).direction.forEach((n: number, i: number) => expect(n).toBeCloseTo(orbit[i], 3));
  await settings(page, 'guided', 'guided');
  await row(page, 1);
  await attachment(page, 'TRACKING');
  await settle(page);
  (await camera(page)).direction.forEach((n: number, i: number) => expect(n).toBeCloseTo(orbit[i], 3));
  await row(page, 4);
  expect((await focus(page))[1]).toBe(true);
  await settle(page);
  const profile = (await focus(page))[2];
  const length = Math.hypot(...profile.cameraOrientation);
  (await camera(page)).direction.forEach((n: number, i: number) =>
    expect(n).toBeCloseTo(profile.cameraOrientation[i] / length, 2),
  );
  await page.locator('#replay').click();
  expect((await focus(page)).slice(0, 2)).toEqual(['device', true]);
  await settle(page);
  const before = await camera(page);
  for (const id of ['collapse-inspector', 'collapse-journey', 'restore-inspector', 'restore-journey'])
    await page.locator('#' + id).click();
  expect(await camera(page)).toEqual(before);
  expect(before.orthographic).toBe(true);
});

test('Stop, same-stage restart and scenario replacement clear stale guidance/reading ownership', async ({
  page,
}) => {
  await prepare(page, 'AUTO');
  await page.locator('#inspector-body').hover();
  await page.mouse.wheel(0, 80);
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'READING_HOLD');
  await page.locator('#replay').click();
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', '');
  await stage(page, 0);
  await page.locator('#scene-switcher [data-scene="block"]').click();
  await page.locator('#scenario').selectOption('vision');
  await attachment(page, 'TRACKING');
  await advancing(page, false);
  await stage(page, 0);
  expect((await focus(page)).slice(0, 2)).toEqual(['device', true]);
  await expect(page.locator('.world-callout[data-role="guided"]')).toHaveCount(1);
  await page.locator('#stop-tour').click();
  await expect(page.locator('.world-callout[data-role="guided"]')).toHaveCount(0);
  await expect(page.locator('#resume-focus')).toBeHidden();
  await page.locator('#journey-mode').selectOption('MANUAL');
  await page.locator('#start-tour').click();
  await advancing(page, false);
  await attachment(page, 'TRACKING');
});

for (const theme of ['light', 'dark'])
  test(`${theme}: navigation preferences and guided/comparison scene states visual review`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page);
    if (theme === 'dark') await page.locator('#theme').click();
    await page.locator('#settings-open').click();
    await page.getByLabel('Earlier-stage jumps').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/part6/${theme}-settings.png` });
    await page.keyboard.press('Escape');
    await row(page, 6);
    await settle(page);
    await page.screenshot({ path: `artifacts/part6/${theme}-guided.png` });
    await row(page, 3);
    await settle(page);
    await page.screenshot({ path: `artifacts/part6/${theme}-comparison.png` });
    await page.locator('#resume-focus').click();
    await settle(page);
    await page.screenshot({ path: `artifacts/part6/${theme}-resumed.png` });
    await expect(page.locator('.world-callout[data-role="guided"]')).toContainText('4 / 18');
    await attachment(page, 'TRACKING');
  });

test('navigation preferences preserve active reading, explicit pause and detached blockers independently', async ({
  page,
}) => {
  await prepare(page, 'AUTO');
  await page.locator('#inspector-body').hover();
  await page.mouse.wheel(0, 80);
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'READING_HOLD');
  const before = await camera(page);
  await page.locator('#settings-open').click();
  await page.getByLabel('Earlier-stage jumps').selectOption('guided');
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'READING_HOLD SETTINGS');
  await page.keyboard.press('Escape');
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', 'READING_HOLD');
  expect(await camera(page)).toEqual(before);
  await row(page, 1);
  await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', '');
  await advancing(page, true);
  await page.locator('#play').click();
  await page.locator('#scene-switcher [data-scene="block"]').click();
  await settings(page, 'guided', 'compare');
  await attachment(page, 'DETACHED');
  await page.locator('#resume-focus').click();
  await advancing(page, false);
  await stage(page, 1);
  await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play journey');
});

test('cross-scene navigation and comparison never abort an active Live stream', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (!String(input).startsWith('https://example.test/')) return original(input, init);
      (window as any).__navigationSignal = init?.signal;
      const encoder = new TextEncoder();
      const chunk = (text: string) =>
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk('First chunk. '));
              (window as any).__navigationFinish = () => {
                controller.enqueue(chunk('Still here.'));
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
  await prepare(page, 'AUTO', false);
  await page.locator('#settings-open').click();
  await page.getByLabel('Base URL', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('Model identifier', { exact: true }).fill('fixture');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await page.locator('#chat-tab').click();
  await page.locator('#mode').selectOption('live');
  await page.locator('#prompt').fill('Keep streaming through navigation.');
  await page.locator('#send').click();
  await expect(page.locator('.message.assistant p')).toHaveText('First chunk.');
  await page.locator('#scene-switcher [data-scene="block"]').click();
  await search(page, 'gpu', 'gpu');
  await settings(page, 'guided', 'compare');
  await attachment(page, 'DETACHED');
  expect(await page.evaluate(() => (window as any).__navigationSignal.aborted)).toBe(false);
  await page.evaluate(() => (window as any).__navigationFinish());
  await expect(page.locator('#request-status')).toContainText('Response received');
  await expect(page.locator('.message.assistant p')).toHaveText('First chunk. Still here.');
});
