import { test, expect, type Page, type Route } from '@playwright/test';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMwmrbq2b4UBggFAC8MBvW/U/rjAAAAAElFTkSuQmCC';
const file = { name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
const root = (p: Page, id: string) => p.locator(`.workspace-nav [data-workspace="${id}"]`);
const answer = {
  choices: [{ message: { content: 'Observed image answer' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10 },
};
async function open(page: Page, support = true) {
  await page.addInitScript((support) => {
    const url = 'https://example.test/v1',
      model = 'test-model';
    localStorage.setItem(
      'atlas-provider',
      JSON.stringify({
        url,
        model,
        stream: false,
        logprobs: false,
        media: {
          url,
          model,
          generationModel: 'image-model',
          imageText: support ? 'SUPPORTED' : 'UNKNOWN',
          imageGeneration: support ? 'SUPPORTED' : 'UNKNOWN',
          generatedMedia: support ? 'SUPPORTED' : 'UNKNOWN',
          streaming: 'UNKNOWN',
          logprobs: 'UNKNOWN',
        },
      }),
    );
  }, support);
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-viewport canvas')).toBeVisible();
}
async function selectImage(page: Page) {
  await page.locator('#live-request-type').selectOption('IMAGE_UNDERSTANDING');
  await page.locator('#live-image-file').setInputFiles(file);
  await expect(page.locator('#live-image-preview')).toBeVisible();
  await expect(page.locator('#live-submit')).toBeEnabled();
}
async function generation(page: Page) {
  await page.locator('#live-request-type').selectOption('IMAGE_GENERATION');
  await page.locator('#live-prompt').fill('Create a small geometric image.');
  await page.locator('#live-submit').click();
}

test('unknown image support stays disabled; settings declarations are scoped and invalidated on model changes', async ({
  page,
}) => {
  await open(page, false);
  await expect(page.locator('#live-request-type option[value="IMAGE_UNDERSTANDING"]')).toBeDisabled();
  await expect(page.locator('#live-request-type option[value="IMAGE_GENERATION"]')).toBeDisabled();
  await page.locator('#live-settings').click();
  await page.locator('.media-configuration summary').click();
  await page.locator('#provider-media-imageText').selectOption('SUPPORTED');
  await page.locator('#provider-media-imageGeneration').selectOption('SUPPORTED');
  await page.locator('#provider-media-generatedMedia').selectOption('SUPPORTED');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.locator('#live-request-type option[value="IMAGE_UNDERSTANDING"]')).toBeEnabled();
  await expect(page.locator('#live-request-type option[value="IMAGE_GENERATION"]')).toBeEnabled();
  await page.locator('#live-settings').click();
  await page.locator('#provider-model').fill('changed-model');
  await expect(page.locator('#provider-media-imageText')).toHaveValue('UNKNOWN');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.locator('#live-request-type option[value="IMAGE_UNDERSTANDING"]')).toBeDisabled();
});

test('real image selection validates, previews, replaces and removes without submitting or persisting', async ({
  page,
}) => {
  await open(page);
  let requests = 0;
  await page.route('https://example.test/**', (r) => {
    requests++;
    return r.fulfill({ json: answer });
  });
  await page.locator('#live-request-type').selectOption('IMAGE_UNDERSTANDING');
  await page
    .locator('#live-image-file')
    .setInputFiles({ name: 'not.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('#live-input-error')).toContainText('does not match');
  await expect(page.locator('#live-submit')).toBeDisabled();
  await page.locator('#live-image-file').setInputFiles(file);
  await expect(page.locator('#live-image-preview figcaption')).toContainText('2 × 2');
  expect(
    await page.locator('#live-image-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(2);
  await page.locator('#live-image-file').setInputFiles({ ...file, name: 'replacement.png' });
  await expect(page.locator('#live-submit')).toBeEnabled();
  expect(requests).toBe(0);
  await page.locator('#live-remove-image').click();
  await expect(page.locator('#live-image-preview')).toBeHidden();
  await expect(page.locator('#live-submit')).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(png);
});

test('image + optional text uses genuine multimodal encoding, parks in Explore and returns without resending', async ({
  page,
}) => {
  await open(page);
  let pending!: Route,
    count = 0;
  await page.route('https://example.test/**', (r) => {
    pending = r;
    count++;
  });
  await selectImage(page);
  await page.locator('#live-submit').click();
  await expect.poll(() => !!pending).toBe(true);
  const body = pending.request().postDataJSON();
  expect(body.messages[0].content).toEqual([
    { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
  ]);
  expect(body.stream).toBe(false);
  await page.locator('#live-mode').selectOption('MANUAL');
  await expect(page.locator('#live-stages button')).toHaveCount(6);
  await page.locator('#live-inspector [data-explore-reference]').click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'image');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await pending.fulfill({ json: answer });
  await page.locator('#global-session-return').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  await expect(page.locator('#live-timeline')).toHaveValue('0');
  await expect(page.locator('#live-response')).toHaveText('Observed image answer');
  await expect(page.locator('#live-stages button')).toHaveCount(7);
  expect(count).toBe(1);
  await page.locator('#live-image-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/v4/part7b-image-understanding-light.png' });
});

test('generation can finish after educational completion and a Demo start; media stays Live-owned across Replay and Explore freely', async ({
  page,
}) => {
  await open(page);
  let pending!: Route,
    count = 0;
  await page.route('https://example.test/**', (r) => {
    pending = r;
    count++;
  });
  await generation(page);
  await expect.poll(() => !!pending).toBe(true);
  expect(pending.request().url()).toBe('https://example.test/v1/images/generations');
  expect(pending.request().postDataJSON()).toEqual({
    model: 'image-model',
    prompt: 'Create a small geometric image.',
    n: 1,
  });
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.locator('#live-stages button').last().click();
  await page.locator('#live-complete').click();
  await expect(page.locator('#global-session')).toBeHidden();
  const position = await page.locator('#live-timeline').inputValue();
  await root(page, 'DEMO').click();
  await page.getByRole('button', { name: 'Start journey', exact: true }).click();
  await pending.fulfill({
    json: {
      data: [{ b64_json: png, revised_prompt: 'An actual mocked image result' }],
      created: 123,
      usage: { output_tokens: 3 },
    },
  });
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'COMPLETED');
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-completed', 'true');
  await expect(page.locator('#live-timeline')).toHaveValue(position);
  await expect(page.locator('#live-generated-images img')).toHaveAttribute(
    'src',
    `data:image/png;base64,${png}`,
  );
  await page.locator('#global-session-end').click();
  await page.locator('#live-replay').click();
  await expect(page.locator('#live-timeline')).toHaveValue('0');
  expect(count).toBe(1);
  await page.locator('#live-stages button').last().click();
  await page.locator('#live-complete').click();
  await page.locator('#live-explore-freely').click();
  await expect(page.locator('#live-generated-images img')).toHaveCount(1);
  await expect(page.locator('#live-guidance-status')).toHaveText('Free exploration');
  expect(count).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(png);
});

test('generation result is independent of stage and modal holds; light/dark desktop/tablet/mobile media remains usable', async ({
  page,
}) => {
  await open(page);
  let pending!: Route;
  await page.route('https://example.test/**', (r) => {
    pending = r;
  });
  await generation(page);
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.locator('#live-settings').click();
  await expect.poll(() => !!pending).toBe(true);
  await pending.fulfill({ json: { data: [{ b64_json: png }], created: 123 } });
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'COMPLETED');
  await expect(page.locator('#live-timeline')).toHaveValue('0');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.locator('[data-live-stage="5"]').click();
  await page.locator('#live-media-output').scrollIntoViewIfNeeded();
  await expect(page.locator('#live-generated-images img')).toBeVisible();
  await page.screenshot({ path: 'artifacts/v4/part7b-generation-light-desktop.png' });
  await page.locator('#theme').click();
  await page.screenshot({ path: 'artifacts/v4/part7b-generation-dark-desktop.png' });
  for (const [width, height, name] of [
    [820, 1180, 'tablet'],
    [390, 844, 'mobile'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.locator('[data-live-panel="runtime"]').click();
    await page.locator('#live-media-output').scrollIntoViewIfNeeded();
    await expect(page.locator('#live-generated-images img')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/v4/part7b-generation-dark-${name}.png` });
    await page.locator('[data-live-close="runtime"]').click();
  }
});

test('generation cancellation and malformed media fail safely without ending the educational journey', async ({
  page,
}) => {
  await open(page);
  let pending!: Route;
  await page.route('https://example.test/**', (r) => {
    pending = r;
  });
  await generation(page);
  await expect.poll(() => !!pending).toBe(true);
  await page.locator('#live-cancel').click();
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'CANCELLED');
  await expect(page.locator('#live-playback')).toHaveAttribute('data-journey-active', 'true');
  await pending.fulfill({ json: { data: [{ b64_json: png }] } }).catch(() => {});
  await expect(page.locator('#live-generated-images img')).toHaveCount(0);
  await page.locator('#live-stop').click();
  await page.unroute('https://example.test/**');
  await page.route('https://example.test/**', (r) =>
    r.fulfill({ json: { data: [{ url: 'javascript:alert(1)' }] } }),
  );
  await page.locator('#live-submit').click();
  await expect(page.locator('#live-workspace')).toHaveAttribute('data-request-state', 'FAILED');
  await expect(page.locator('#live-error')).toContainText('HTTPS');
  await expect(page.locator('#live-generated-images img')).toHaveCount(0);
});
