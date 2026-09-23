import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page) {
  const sceneResponse = page.waitForResponse((response) => /\/src\/scene\.ts(?:\?|$)/.test(response.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const modulePath = (await sceneResponse).url();
  await page.clock.install();
  // Observe the loaded renderer (including Vite's HMR URL) without a production debug API.
  await page.evaluate(async (modulePath) => {
    const { AtlasScene } = await import(/* @vite-ignore */ modulePath);
    const original = AtlasScene.prototype.setPresentationSuspended;
    AtlasScene.prototype.setPresentationSuspended = function (value: boolean) {
      (window as any).__presentationRead = () => ({
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
        zoom: this.camera.zoom,
        projection: this.camera.projectionMatrix.toArray(),
        destination: this.panTarget?.toArray(),
        packet: this.packet.position.toArray(),
        packetVisible: this.packet.visible,
        packetElapsed: this.packetElapsed,
        selected: this.selected,
        scene: this.sceneId,
      });
      const before = (window as any).__presentationRead();
      original.call(this, value);
      (window as any).__presentationEdge = { before, after: (window as any).__presentationRead() };
    };
  }, modulePath);
}
const read = (page: Page) => page.evaluate(() => (window as any).__presentationRead());
const open = (page: Page) => page.getByRole('button', { name: 'Settings', exact: true }).click();
const start = (page: Page) => page.getByRole('button', { name: 'Start journey', exact: true }).click();
const advanceState = (page: Page, value: boolean) =>
  expect(page.locator('.playback')).toHaveAttribute('data-advancing', String(value));

for (const close of ['X', 'outside', 'Escape', 'save', 'Cancel'] as const) {
  test(`Auto Settings suspension preserves remaining time and clears on ${close}`, async ({ page }) => {
    await prepare(page);
    await start(page);
    await page.clock.runFor(1100);
    await open(page);
    const frozen = await read(page);
    expect(frozen.packetVisible).toBe(true);
    await advanceState(page, false);
    await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
    await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('AUTO');
    await page.clock.runFor(500);
    await page.clock.fastForward(30000);
    expect(await read(page)).toEqual(frozen);
    await expect(page.locator('#timeline')).toHaveValue('0');
    if (close === 'X') await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    if (close === 'outside') await page.mouse.click(2, 2);
    if (close === 'Escape') await page.keyboard.press('Escape');
    if (close === 'Cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (close === 'save') {
      await page.getByLabel('Base URL', { exact: true }).fill('https://example.test/v1');
      await page.getByLabel('Model identifier', { exact: true }).fill('fixture');
      await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    }
    await expect(page.locator('#settings-dialog')).not.toBeVisible();
    await advanceState(page, true);
    // Neither a restart (6000ms remaining) nor suspended wall time (already due).
    await page.clock.runFor(4700);
    await expect(page.locator('#timeline')).toHaveValue('0');
    await page.clock.runFor(400);
    await expect(page.locator('#timeline')).toHaveValue('1');
  });
}

for (const blocker of ['detached', 'paused'] as const) {
  test(`Settings cannot clear an existing ${blocker} Auto journey`, async ({ page }) => {
    await prepare(page);
    await start(page);
    await page.clock.runFor(1600);
    if (blocker === 'detached') {
      await page.mouse.move(12, 500);
      await page.mouse.wheel(0, -160);
    } else await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
    await page.clock.runFor(400);
    const before = await read(page);
    await open(page);
    await page.clock.fastForward(30000);
    expect(await read(page)).toEqual(before);
    await page.keyboard.press('Escape');
    await page.clock.runFor(3000);
    expect(await read(page)).toEqual(before);
    await expect(page.locator('#timeline')).toHaveValue('0');
    await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('AUTO');
    await expect(page.locator('.playback')).toHaveAttribute(
      'data-guided-focus',
      blocker === 'detached' ? 'DETACHED' : 'TRACKING',
    );
    await advanceState(page, false);
    if (blocker === 'detached') {
      await expect(page.getByRole('button', { name: 'Pause journey', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Resume focus', exact: true }).click();
    } else await page.getByRole('button', { name: 'Play journey', exact: true }).click();
    await page.clock.runFor(4500);
    await expect(page.locator('#timeline')).toHaveValue('1');
  });
}

test('Manual Settings freezes and continues the same eased camera transition; display edits remain live', async ({
  page,
}) => {
  await prepare(page);
  await page.getByLabel('Journey mode', { exact: true }).selectOption('MANUAL');
  await start(page);
  await page.clock.runFor(160);
  const before = await read(page);
  expect(before.destination).toBeDefined();
  await open(page);
  const frozen = await read(page);
  expect(frozen.destination).toEqual(before.destination);
  const opened = await page.evaluate(() => (window as any).__presentationEdge);
  expect(opened.after).toEqual(opened.before);
  await page.clock.runFor(500);
  await page.clock.fastForward(30000);
  expect(await read(page)).toEqual(frozen);
  const canvas = page.locator('#viewport canvas');
  const gridBefore = await canvas.screenshot();
  await page.getByLabel('Grid intensity', { exact: true }).fill('100');
  await page.clock.runFor(32);
  expect(Buffer.compare(gridBefore, await canvas.screenshot())).not.toBe(0);
  expect(await read(page)).toEqual(frozen);
  await page.screenshot({ path: 'artifacts/v3-part2-1-settings-suspended.png' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const closed = await page.evaluate(() => (window as any).__presentationEdge);
  expect(closed.after).toEqual(closed.before);
  await page.clock.runFor(160);
  const first = await read(page);
  expect(first.target[0]).toBeLessThan(frozen.target[0]);
  expect(first.target[0]).toBeGreaterThan(-6);
  await page.clock.runFor(160);
  const second = await read(page);
  expect(frozen.target[0] - first.target[0]).toBeGreaterThan(first.target[0] - second.target[0]);
  await page.clock.runFor(3000);
  expect((await read(page)).target[0]).toBeCloseTo(-6, 2);
  expect((await read(page)).zoom).toBeCloseTo(1.65, 3);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('MANUAL');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  await advanceState(page, false);
});

for (const mode of ['AUTO', 'MANUAL']) {
  test(`inactive ${mode} preference stays inactive through Settings`, async ({ page }) => {
    await prepare(page);
    await page.getByLabel('Journey mode', { exact: true }).selectOption('MANUAL');
    await page.getByLabel('Journey mode', { exact: true }).selectOption(mode);
    await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
    const before = await read(page);
    await open(page);
    await page.clock.fastForward(30000);
    await page.keyboard.press('Escape');
    await page.clock.runFor(3000);
    expect(await read(page)).toEqual(before);
    await expect(page.locator('.playback')).toHaveAttribute('data-journey-active', 'false');
    await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue(mode);
    await expect(page.locator('#timeline')).toHaveValue('0');
    await advanceState(page, false);
  });
}

test('an active Live stream continues receiving and completes while Settings suspends presentation', async ({
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
  await prepare(page);
  await open(page);
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
  await open(page);
  const frozen = await read(page);
  await advanceState(page, false);
  await page.clock.fastForward(30000);
  expect(await page.evaluate(() => (window as any).__liveSignal.aborted)).toBe(false);
  await page.evaluate(() => (window as any).__finishLive());
  await expect(page.locator('#request-status')).toContainText('Response received');
  await expect(page.locator('.message.assistant p')).toHaveText('First chunk. Still streaming.');
  expect(await read(page)).toEqual(frozen);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.keyboard.press('Escape');
  await advanceState(page, true);
  await page.clock.runFor(5600);
  await expect(page.locator('#timeline')).toHaveValue('1');
});
