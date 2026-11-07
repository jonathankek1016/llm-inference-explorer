import { test, expect, type Page, type Route } from '@playwright/test';
const root = (p: Page, id: string) => p.locator(`.workspace-nav [data-workspace="${id}"]`);
async function open(page: Page, stream = false) {
  await page.addInitScript(
    (stream) =>
      localStorage.setItem(
        'atlas-provider',
        JSON.stringify({ url: 'https://example.test/v1', model: 'test-model', stream, logprobs: true }),
      ),
    stream,
  );
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-viewport canvas')).toBeVisible();
}
async function submit(page: Page) {
  await page.locator('#live-prompt').fill('Explain this text. Weather documents tools.');
  await page.locator('#live-submit').click();
}
const response = {
  choices: [{ message: { content: 'Actual mocked answer' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
};
async function delayed(page: Page) {
  let route!: Route;
  await page.route('https://example.test/**', (r) => {
    route = r;
  });
  return async () => {
    await expect.poll(() => !!route).toBe(true);
    await route.fulfill({ json: response });
  };
}
test('idle setup is truthful and a real intercepted text result stays separate from teaching', async ({
  page,
}) => {
  await page.goto('/');
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-submit')).toBeDisabled();
  await expect(page.locator('#live-playback')).toBeHidden();
  await expect(page.locator('#live-request-status')).toHaveText('No request yet');
  await page.locator('#live-settings').click();
  await page.locator('#provider-url').fill('https://example.test/v1');
  await page.locator('#provider-model').fill('test-model');
  await page.locator('#provider-stream').uncheck();
  await page.getByRole('button', { name: 'Save connection' }).click();
  await page.route('https://example.test/**', (r) => r.fulfill({ json: response }));
  await submit(page);
  await expect(page.locator('#live-response')).toHaveText('Actual mocked answer');
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'COMPLETED');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-completed', 'false');
  await expect(page.locator('#live-timeline')).toHaveValue('0');
  expect(await page.locator('#live-workspace').getAttribute('data-request-id')).not.toBe(
    await page.locator('#app').getAttribute('data-guided-session'),
  );
  await page.locator('#live-receipts summary').first().click();
  await expect(page.locator('#live-receipt-body')).toContainText(
    'IDLE → PREPARING → RUNNING → COMPLETING → COMPLETED',
  );
  await expect(page.locator('#live-stages button')).toHaveCount(5);
  expect(await page.evaluate(() => localStorage.getItem('atlas-history'))).not.toContain(
    'Actual mocked answer',
  );
});
test('parked Live request completes in Explore; manual return stays detached and global Return resumes', async ({
  page,
}) => {
  await open(page);
  const finish = await delayed(page);
  await submit(page);
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.locator('#live-next').click();
  await page.locator('#live-inspector [data-explore-reference]').click();
  await expect(root(page, 'EXPLORE')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'context');
  await expect(page.locator('#global-session-label')).toContainText('Live Lab · Text · Session parked');
  await expect(page.locator('#explore-workspace .world-callout[data-role="guided"]')).toHaveCount(0);
  await finish();
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'COMPLETED');
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await root(page, 'EXPLORE').click();
  await page.locator('#global-session-return').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  await expect(page.locator('#live-timeline')).toHaveValue('1');
  await expect(page.locator('#live-mode')).toHaveValue('MANUAL');
  await expect(page.locator('#live-response')).toHaveText('Actual mocked answer');
});
test('Manual completion releases slot before request finishes; Demo starts and late result stays Live-owned', async ({
  page,
}) => {
  await open(page);
  const finish = await delayed(page);
  await submit(page);
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.locator('#live-timeline').fill('3');
  await page.locator('#live-complete').click();
  await expect(page.locator('#global-session')).toBeHidden();
  await expect(page.locator('#live-guidance-status')).toHaveText('Journey complete');
  await root(page, 'DEMO').click();
  await page.locator('#start-tour').click();
  await finish();
  await expect(page.locator('#global-session-label')).toContainText('Demo Lab');
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-guidance-status')).toHaveText('Journey complete');
  await expect(page.locator('#live-position')).toHaveText('4 / 4');
  await expect(page.locator('#live-response')).toHaveText('Actual mocked answer');
  await page.locator('#live-replay').click();
  await expect(page.locator('#session-conflict')).toBeVisible();
  await page.locator('#session-conflict-end').click();
  await expect(page.locator('#live-guidance-status')).toHaveText('Journey complete');
  await page.locator('#live-replay').click();
  await expect(page.locator('#live-position')).toHaveText('1 / 5');
});
test('another lesson blocks Live guidance, not request execution; Cancel and End are independent', async ({
  page,
}) => {
  await open(page);
  await root(page, 'DEMO').click();
  await page.locator('#start-tour').click();
  await root(page, 'LIVE').click();
  const finish = await delayed(page);
  await submit(page);
  await expect(page.locator('#session-conflict')).toBeVisible();
  await page.locator('#session-conflict-cancel').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-journey-active', 'false');
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'RUNNING');
  await page.locator('#global-session-end').click();
  await page.locator('#live-start').click();
  await page.locator('#global-session-end').click();
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'RUNNING');
  await page.locator('#live-start').click();
  await page.locator('#live-cancel').click();
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'CANCELLED');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-journey-active', 'true');
  await finish();
  await expect(page.locator('#live-response')).not.toContainText('Actual mocked answer');
});
test('SSE output and provider fields are observed, unknown values are never substituted', async ({
  page,
}) => {
  await open(page, true);
  await page.route('https://example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body:
        'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'Streamed ' } }] }) +
        '\n\ndata: ' +
        JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }) +
        '\n\ndata: [DONE]\n\n',
    }),
  );
  await submit(page);
  await expect(page.locator('#live-response')).toHaveText('Streamed answer');
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'COMPLETED');
  await page.locator('#live-receipts summary').first().click();
  await expect(page.locator('#live-receipt-body')).toContainText('Usage was not returned');
  await expect(page.locator('#live-stages button')).toHaveCount(5);
});
test('Auto timing, Reading Hold and modal blockers do not pause the provider; natural completion retains presentation', async ({
  page,
}) => {
  await open(page);
  const finish = await delayed(page);
  await page.clock.install();
  await submit(page);
  await page.clock.runFor(1500);
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.clock.runFor(9000);
  await expect(page.locator('#live-timeline')).toHaveValue('0');
  await page.locator('#live-mode').selectOption('AUTO');
  await page.locator('#live-inspector-body h2').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', 'READING_HOLD');
  await page.locator('#settings-open').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', /SETTINGS/);
  await finish();
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'COMPLETED');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.locator('#live-timeline').fill('4');
  await page.clock.runFor(6500);
  await expect(page.locator('#live-guidance-status')).toHaveText('Journey complete');
  await expect(page.locator('#global-session')).toBeHidden();
  await expect(page.locator('#live-play')).toBeDisabled();
  await page.locator('#live-explore-freely').click();
  await expect(page.locator('#live-guidance-status')).toHaveText('Free exploration');
  await expect(page.locator('#live-response')).toHaveText('Actual mocked answer');
});
test('request errors are safe evidence without stopping the lesson', async ({ page }) => {
  await open(page);
  let route!: Route;
  await page.route('https://example.test/**', (r) => {
    route = r;
  });
  await submit(page);
  await expect.poll(() => !!route).toBe(true);
  await route.fulfill({ status: 500, json: { error: { message: 'Mock backend unavailable' } } });
  await expect(page.locator('#live-error')).toContainText('Mock backend unavailable');
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'FAILED');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-journey-active', 'true');
});

test('Live presentation is local; responsive light/dark layouts keep request, evidence and recovery usable', async ({
  page,
}) => {
  await open(page);
  await page.route('https://example.test/**', (r) => r.fulfill({ json: response }));
  await submit(page);
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.locator('#live-timeline').fill('3');
  await expect(page.locator('#live-workspace .world-callout[data-role="guided"]')).toHaveCount(1);
  await expect(page.locator('#live-workspace .world-callout[data-role="guided"]')).toContainText(
    'Illustrative',
  );
  await expect(page.locator('#live-inspector-body')).toContainText('Unknown');
  await page.waitForTimeout(800);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme').click();
    await page.screenshot({ path: `artifacts/v4/part7a-desktop-${theme}.png` });
  }
  await root(page, 'EXPLORE').click();
  await expect(page.locator('#live-workspace')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#explore-workspace .world-callout[data-role="guided"]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/v4/part7a-parked-explore.png' });
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  for (const [width, height] of [
    [820, 1180],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('#live-viewport canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.locator('[data-live-panel="runtime"]').click();
    await expect(page.locator('#live-response')).toBeVisible();
    await page.screenshot({ path: `artifacts/v4/part7a-${width}-runtime.png` });
    await page.locator('[data-live-panel="inspector"]').click();
    await expect(page.locator('#live-inspector [data-explore-reference]')).toBeVisible();
    await page.screenshot({ path: `artifacts/v4/part7a-${width}-inspector.png` });
    await page.locator('[data-live-close="inspector"]').click();
  }
});

test('Live camera, callouts and particle phase are local; modal suspension composes with Reading Hold', async ({
  page,
}) => {
  const module = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await open(page);
  await page.evaluate(
    async (path) => {
      const { AtlasScene } = await import(/* @vite-ignore */ path);
      const original = AtlasScene.prototype.setTeachingFlow;
      AtlasScene.prototype.setTeachingFlow = function (...args: any[]) {
        if (this.renderer.domElement.parentElement?.id === 'live-viewport')
          (window as any).__liveScene = this;
        return original.apply(this, args);
      };
    },
    (await module).url(),
  );
  const finish = await delayed(page);
  await page.clock.install();
  await submit(page);
  const phase = () => page.evaluate(() => (window as any).__liveScene.packetElapsed);
  const pose = () =>
    page.evaluate(() => {
      const s = (window as any).__liveScene;
      return {
        camera: s.camera.position.toArray(),
        target: s.controls.target.toArray(),
        zoom: s.camera.zoom,
      };
    });
  await page.clock.runFor(500);
  const a = await phase();
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.clock.runFor(500);
  expect(await phase()).toBeGreaterThan(a);
  await page.locator('#live-mode').selectOption('AUTO');
  await page.locator('#live-play').click();
  await page.locator('#live-inspector-body h2').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', 'READING_HOLD');
  const beforeHold = await phase();
  await page.clock.runFor(300);
  expect(await phase()).toBeGreaterThan(beforeHold);
  await page.locator('#appearance-open').click();
  const frozen = await phase();
  await page.clock.runFor(500);
  expect(await phase()).toBe(frozen);
  await page.getByRole('button', { name: 'Close appearance' }).click();
  await page.clock.runFor(300);
  expect(await phase()).toBeGreaterThan(frozen);
  await expect(page.locator('#live-play')).toHaveAttribute('aria-label', 'Play Live journey');
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.clock.runFor(1800);
  const view = await pose();
  await root(page, 'EXPLORE').click();
  await page.clock.runFor(500);
  await root(page, 'LIVE').click();
  expect(await pose()).toEqual(view);
  await expect(page.locator('#live-playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.locator('#live-viewport [data-concept="router"]').click();
  await page.locator('[data-live-close="inspector"]').click();
  await page.locator('#live-viewport [data-concept="internet"]').click();
  await expect(page.locator('#live-workspace .world-callout[data-role="exploratory"]')).toHaveCount(2);
  await expect(page.locator('#live-workspace .world-callout[data-role="guided"]')).toHaveCount(1);
  await page.locator('#live-inspector [data-explore-reference]').click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'internet');
  await page.locator('#global-session-return').click();
  await expect(page.locator('#live-timeline')).toHaveValue('0');
  await finish();
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'COMPLETED');
});
