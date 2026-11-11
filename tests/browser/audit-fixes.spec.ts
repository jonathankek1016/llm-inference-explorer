import { test, expect, type Page, type Route } from '@playwright/test';

const root = (page: Page, workspace: string) =>
  page.locator(`.workspace-nav [data-workspace="${workspace}"]`);
const answer = {
  choices: [{ message: { content: 'Mocked response' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
};
async function connection(page: Page, key = '') {
  await page.locator('#settings-open').click();
  await page.locator('#provider-url').fill('https://example.test/v1');
  await page.locator('#provider-model').fill('mock');
  await page.locator('#provider-key').fill(key);
  await page.locator('#provider-stream').uncheck();
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
}

test('fresh V4 startup enters canonical Explore; switching preserves idle hosts', async ({ page }) => {
  await page.goto('/');
  await expect(root(page, 'EXPLORE')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#explore-viewport canvas')).toBeVisible();
  await expect(page.locator('#demo-host')).toHaveAttribute('inert', '');
  await expect(page.locator('#global-session')).toBeHidden();
  await root(page, 'DEMO').click();
  await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
  await expect(page.locator('#start-tour')).toBeVisible();
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-request-status')).toHaveText('No request yet');
  await root(page, 'EXPLORE').click();
  await expect(page.locator('#explore-gallery-title')).toHaveText('The concept atlas');
  await page.reload();
  await expect(root(page, 'EXPLORE')).toHaveAttribute('aria-current', 'page');
});

test('Demo errors redact the credential belonging to the failed request, even after configuration changes', async ({
  page,
}) => {
  const key = 'fake-demo-secret-for-regression';
  let pending: Route | undefined;
  await page.route('https://example.test/**', (route) => {
    pending = route;
  });
  await page.goto('/');
  await root(page, 'DEMO').click();
  await connection(page, key);
  await page.locator('#chat-tab').click();
  await page.locator('#mode').selectOption('live');
  await page.locator('#prompt').fill('Mock error please');
  await page.locator('#send').click();
  await expect.poll(() => !!pending).toBe(true);
  await connection(page, 'different-fake-key');
  await pending!.fulfill({
    status: 401,
    json: { error: { message: `Invalid credential ${key}; model mock denied` } },
  });
  await expect(page.locator('#request-status')).toContainText('[redacted]');
  await expect(page.locator('#request-status')).toContainText('model mock denied');
  await expect(page.locator('body')).not.toContainText(key);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(key);
});

test('pristine Live owns multiple exploratory cards without a request or guided session', async ({
  page,
}) => {
  await page.goto('/');
  await root(page, 'LIVE').click();
  const live = page.locator('#live-workspace');
  await expect(page.locator('#live-viewport canvas')).toBeVisible();
  for (const id of ['device', 'router', 'internet', 'router']) {
    await live.locator(`.object-label[data-concept="${id}"]`).focus();
    await page.keyboard.press('Enter');
  }
  await expect(live.locator('.world-callout[data-role="exploratory"]')).toHaveCount(3);
  await expect(live.locator('.world-callout[data-role="guided"]')).toHaveCount(0);
  await live.locator('.world-callout[data-subject="router"] button').first().click();
  await expect(live.locator('.world-callout[data-role="exploratory"]')).toHaveCount(2);
  await expect(live.locator('.world-callout[data-subject="device"]')).toHaveCount(1);
  await expect(live.locator('.world-callout[data-subject="internet"]')).toHaveCount(1);
  await expect(page.locator('#live-playback')).toBeHidden();
  await expect(page.locator('#live-request-status')).toHaveText('No request yet');
  await expect(page.locator('#global-session')).toBeHidden();
  await expect(page.locator('#live-receipt-body')).toHaveText('No runtime evidence yet.');
});

test('admitted same-stage Live Replay clears its reading lease without resending or clearing modal ownership', async ({
  page,
}) => {
  let calls = 0;
  await page.route('https://example.test/**', (route) => {
    calls++;
    return route.fulfill({ json: answer });
  });
  await page.goto('/');
  await connection(page);
  await root(page, 'LIVE').click();
  await page.clock.install();
  await page.locator('#live-prompt').fill('Mock replay');
  await page.locator('#live-submit').click();
  await expect(page.locator('#live-response')).toHaveText('Mocked response');
  const request = await page.locator('#live-workspace').getAttribute('data-request-id');
  await page.locator('#live-mode').selectOption('AUTO');
  await page.locator('#live-inspector-body').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', /READING_HOLD/);
  await page.locator('#live-replay').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', '');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-advancing', 'true');
  await page.locator('#live-inspector-body').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', /READING_HOLD/);
  await page.locator('#settings-open').click();
  // Exercise admitted restart with modal ownership still present; the UI remains modal/inert.
  await page.locator('#live-replay').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', 'SETTINGS');
  await page.keyboard.press('Escape');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-suspensions', '');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-advancing', 'true');
  await expect(page.locator('#live-timeline')).toHaveValue('0');
  await page.clock.runFor(6500);
  await expect(page.locator('#live-timeline')).not.toHaveValue('0');
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-id', request!);
  expect(calls).toBe(1);
});

test('Live usage and timing disclosures survive teaching renders and remain request-scoped', async ({
  page,
}) => {
  await page.route('https://example.test/**', (route) => route.fulfill({ json: answer }));
  await page.goto('/');
  await connection(page);
  await root(page, 'LIVE').click();
  await page.clock.install();
  await page.locator('#live-prompt').fill('First mock request');
  await page.locator('#live-submit').click();
  await expect(page.locator('#live-response')).toHaveText('Mocked response');
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.locator('#live-receipts > summary').click();
  const receipts = page.locator('#live-receipt-body');
  const usage = receipts.locator('details').filter({ has: page.locator('summary', { hasText: /^usage$/ }) });
  const timing = receipts
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: /^client-timing$/ }) });
  await usage.locator('summary').click();
  await timing.locator('summary').click();
  const firstId = await usage.getAttribute('data-event');
  await page.locator('#live-next').click();
  await page.locator('#live-mode').selectOption('AUTO');
  await expect(usage).toHaveAttribute('open', '');
  await expect(timing).toHaveAttribute('open', '');
  await page.locator('#live-stop').click();
  await expect(usage).toHaveAttribute('open', '');
  await page.locator('#live-prompt').fill('Second mock request');
  await page.locator('#live-submit').click();
  await expect.poll(() => usage.getAttribute('data-event')).not.toBe(firstId);
  await expect(usage).not.toHaveAttribute('open', '');
  await expect(timing).not.toHaveAttribute('open', '');
});
