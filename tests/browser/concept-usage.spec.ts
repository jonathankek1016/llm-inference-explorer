import { test, expect, type Page } from '@playwright/test';

const root = (page: Page, workspace: string) =>
  page.locator(`.workspace-nav [data-workspace="${workspace}"]`);
async function prepare(page: Page) {
  const module = page.waitForResponse((response) => /\/src\/scene\.ts(?:\?|$)/.test(response.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.clock.install();
  await page.evaluate(
    async (path) => {
      const { AtlasScene } = await import(/* @vite-ignore */ path);
      const original = AtlasScene.prototype.setPresentationSuspended;
      AtlasScene.prototype.setPresentationSuspended = function (value: boolean) {
        (window as any).__usageDemo = this;
        original.call(this, value);
      };
    },
    (await module).url(),
  );
}
async function search(page: Page, concept: string) {
  await page.locator('#search-open').click();
  await page.locator('#search-input').fill(concept);
  await page.locator(`[data-search-concept="${concept}"]`).click();
  await page.clock.runFor(1600);
}
async function usage(page: Page, id: string) {
  const button = page.locator(`[data-demo-usage="${id}"]`);
  await button.locator('xpath=ancestor::details').locator('summary').click();
  await button.click();
}
async function snapshot(page: Page) {
  return page.evaluate(() => ({
    lifecycle: { ...document.querySelector<HTMLElement>('.playback')!.dataset },
    stage: (document.querySelector('#timeline') as HTMLInputElement).value,
    mode: (document.querySelector('#journey-mode') as HTMLSelectElement).value,
    source: (document.querySelector('#mode') as HTMLSelectElement).value,
    scenario: (document.querySelector('#scenario') as HTMLSelectElement).value,
    subject: document.querySelector('#inspector-header h2')!.textContent,
    session: document.querySelector<HTMLElement>('#app')!.dataset.guidedSession,
    camera: JSON.parse(
      JSON.stringify((window as any).__usageDemo?.captureView(), (_key, value) =>
        typeof value === 'number' ? Number(value.toFixed(6)) : value,
      ),
    ),
  }));
}

test('canonical usage list opens an idle authored location without seeking or acquiring; both themes', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#journey-mode').selectOption('MANUAL');
  await root(page, 'EXPLORE').click();
  await search(page, 'decode');
  await expect(page.locator('.concept-usages')).toContainText('Text conversation');
  await expect(page.locator('.concept-usages [data-demo-usage]')).toHaveCount(10);
  await expect(page.locator('.explore-reference')).not.toContainText('Used in Live');
  await expect(page.locator('.explore-reference .source-list a').first()).toHaveAttribute('href', /^https:/);
  await page.locator('.concept-usages summary').first().click();
  await page.locator('.concept-usages').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/v4/part5-explore-light.png' });
  await page.locator('[data-demo-usage="demo:text:cloud:text-15"]').click();
  await expect(root(page, 'DEMO')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.locator('#global-session')).toBeHidden();
  await expect(page.locator('#inspector-body')).toContainText('Authored stage 16 / 18');
  await expect(page.locator('#inspector-body')).toContainText('Occurrence 2');
  await expect(page.locator('#journey-mode')).toHaveValue('MANUAL');
  await page.locator('#theme').click();
  await page.screenshot({ path: 'artifacts/v4/part5-demo-dark.png' });
  await page.locator('[data-explore-reference="decode"]').click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'decode');
  await page.locator('.concept-usages summary').first().click();
  await page.locator('.concept-usages').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/v4/part5-explore-dark.png' });
  await page.locator('[data-demo-usage="demo:text:local:text-10"]').click();
  await expect(page.locator('#route')).toHaveValue('local');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.locator('#start-tour').click();
  await expect(page.locator('#global-session')).toBeVisible();
  await expect(page.locator('#timeline')).toHaveValue('0');
});

for (const mode of ['AUTO', 'MANUAL'])
  test(`${mode}: exact-concept Explore link derails; reading holds and global recovery remain distinct`, async ({
    page,
  }) => {
    await prepare(page);
    await page.locator('#journey-mode').selectOption(mode);
    await page.locator('#start-tour').click();
    await page.locator('#timeline').fill('12');
    // Let the inherited framing ease finish before measuring navigation continuity.
    await page.clock.runFor(2500);
    if (mode === 'AUTO') {
      await page.locator('#inspector-body').hover();
      await page.mouse.wheel(0, 100);
      await expect(page.locator('.playback')).toHaveAttribute('data-suspensions', /READING_HOLD/);
      await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
      await page.clock.runFor(4100);
    }
    const before = await snapshot(page);
    // Pointerdown on the navigation link itself must never acquire Reading Hold.
    await page.locator('[data-explore-reference="cache"]').dispatchEvent('pointerdown');
    await expect(page.locator('.playback')).not.toHaveAttribute('data-suspensions', /READING_HOLD/);
    await page.locator('[data-explore-reference="cache"]').click();
    await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'cache');
    await expect(page.locator('#explore-workspace')).toHaveAttribute('data-gallery', 'catalogue:blocks');
    await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
    await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
    await page.clock.runFor(20000);
    const parked = await snapshot(page);
    expect(parked.stage).toBe(before.stage);
    expect(parked.mode).toBe(before.mode);
    expect(parked.source).toBe(before.source);
    expect(parked.session).toBe(before.session);
    expect(parked.camera).toEqual(before.camera);
    await usage(page, 'demo:text:cloud:text-12');
    await expect(page.locator('#demo-usage-preview')).toBeVisible();
    expect(await snapshot(page)).toEqual(parked);
    await page.getByRole('button', { name: 'Close usage preview' }).click();
    await root(page, 'EXPLORE').click();
    await page.locator('#global-session-return').click();
    await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
    await expect(page.locator('#timeline')).toHaveValue('12');
    await expect(page.locator('.playback')).toHaveAttribute('data-advancing', String(mode === 'AUTO'));
  });

test('different-scenario usage keeps completed presentation; explicit free exploration allows idle destination', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#journey-mode').selectOption('MANUAL');
  await page.locator('#start-tour').click();
  await page.locator('#timeline').fill('17');
  await page.locator('#complete-tour').click();
  await page.clock.runFor(2500);
  const completed = await snapshot(page);
  await page.locator('[data-explore-reference="response"]').click();
  await usage(page, 'demo:tools:cloud:tools-13');
  await expect(page.locator('#demo-usage-preview')).toContainText('Use a tool');
  await expect(page.locator('#demo-usage-preview')).toContainText('completed presentation');
  expect(await snapshot(page)).toEqual(completed);
  await page.screenshot({ path: 'artifacts/v4/part5-retained-preview-light.png' });
  await page.getByRole('button', { name: 'Close usage preview' }).click();
  await page.locator('#theme').click();
  await root(page, 'EXPLORE').click();
  await page.locator('[data-demo-usage="demo:tools:cloud:tools-13"]').click();
  await page.screenshot({ path: 'artifacts/v4/part5-retained-preview-dark.png' });
  await page.getByRole('button', { name: 'Close usage preview' }).click();
  await page.locator('#theme').click();
  await page.locator('#explore-freely').click();
  await root(page, 'EXPLORE').click();
  await page.locator('[data-demo-usage="demo:tools:cloud:tools-13"]').click();
  await expect(page.locator('#scenario')).toHaveValue('tools');
  await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.locator('#global-session')).toBeHidden();
  await expect(page.locator('#inspector-body')).toContainText('Use a tool');
  await page.screenshot({ path: 'artifacts/v4/part5-demo-light.png' });
});

test('usage navigation and contextual reference remain usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await root(page, 'EXPLORE').click();
  await search(page, 'mcp');
  await usage(page, 'demo:tools:cloud:tools-10');
  await expect(page.locator('#inspector-panel')).toHaveClass(/mobile-open/);
  await expect(page.locator('[data-explore-reference="mcp"]')).toBeVisible();
  await page.locator('[data-explore-reference="mcp"]').click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'mcp');
  await expect(page.locator('#global-session')).toBeHidden();
  await page.locator('.concept-usages').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/v4/part5-mobile-reference.png' });
});

test('exploratory inspected subject and zero-usage concept resolve canonically, not to official stage', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#journey-mode').selectOption('MANUAL');
  await page.locator('#start-tour').click();
  await search(page, 'attention');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.locator('#inspector-body')).toContainText('no authored stage');
  await page.locator('[data-explore-reference="attention"]').click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'attention');
  await expect(page.locator('.concept-usages')).toContainText('No authored Demo stages');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.locator('#global-session-return').click();
  await expect(page.locator('#inspector-header h2')).toHaveText('Your device');
});

test('in-flight request survives usage preview while educational journey is inactive', async ({ page }) => {
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    await response;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: 'Usage navigation kept this result' }, finish_reason: 'stop' }],
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
  await page.locator('#stop-tour').click();
  await root(page, 'EXPLORE').click();
  await search(page, 'mcp');
  await usage(page, 'demo:tools:cloud:tools-10');
  await expect(page.locator('#demo-usage-preview')).toContainText('running request');
  await expect(page.locator('#scenario')).toHaveValue('text');
  await expect(page.locator('#mode')).toHaveValue('live');
  await page.getByRole('button', { name: 'Close usage preview' }).click();
  await expect(page.locator('#stop-request')).toBeVisible();
  release();
  await expect(page.locator('#messages')).toContainText('Usage navigation kept this result');
  await expect(page.locator('#guidance-status')).toHaveText('Free exploration');
});
