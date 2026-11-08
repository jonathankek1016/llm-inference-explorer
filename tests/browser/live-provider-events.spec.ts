import { test, expect, type Page, type Route } from '@playwright/test';

const root = (p: Page, id: string) => p.locator(`.workspace-nav [data-workspace="${id}"]`);
const response = {
  choices: [
    {
      message: {
        content: null,
        tool_calls: [
          {
            id: 'call_weather',
            type: 'function',
            function: {
              name: 'weather',
              arguments: '{"city":"Singapore","note":"<img src=x onerror=alert(1)>"}',
            },
          },
        ],
        annotations: [
          {
            type: 'url_citation',
            url_citation: {
              title: 'Provider source',
              url: 'https://example.test/source',
              start_index: 0,
              end_index: 3,
            },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
};
async function open(page: Page, stream = false) {
  await page.addInitScript(
    (stream) =>
      localStorage.setItem(
        'atlas-provider',
        JSON.stringify({
          url: 'https://example.test/v1',
          model: 'mock',
          stream,
          logprobs: false,
        }),
      ),
    stream,
  );
  await page.goto('/');
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-submit')).toBeEnabled();
}
async function send(page: Page) {
  await page.locator('#live-prompt').fill('weather documents search RAG calculate MCP');
  await page.locator('#live-submit').click();
}

test('returned calls and citations stay with parked Live, have honest evidence and canonical Explore links', async ({
  page,
}) => {
  await open(page);
  let pending!: Route;
  let count = 0;
  await page.route('https://example.test/**', (r) => {
    pending = r;
    count++;
  });
  await send(page);
  await expect.poll(() => !!pending).toBe(true);
  await page.locator('#live-mode').selectOption('MANUAL');
  const requestId = await page.locator('#live-workspace').getAttribute('data-request-id');
  await root(page, 'EXPLORE').click();
  await pending.fulfill({ json: response });
  await page.locator('#global-session-return').click();
  await expect(page.locator('#live-request-status')).toContainText('completed');
  await expect(page.locator('#live-response')).toHaveText('No returned text.');
  await expect(page.locator('#live-observations')).toContainText('Execution owner: unknown');
  await expect(page.locator('#live-observations')).toContainText(
    'does not establish that search or retrieval ran',
  );
  await expect(page.locator('#live-observations img')).toHaveCount(0);
  await expect(page.locator('#live-observations a')).toHaveAttribute('rel', 'noopener noreferrer');
  await page.locator('#live-observations details summary').click();
  await expect(page.locator('#live-observations pre')).toContainText('<img');
  await page.locator('#live-stages button').filter({ hasText: 'Provider requested a function' }).click();
  await expect(page.locator('#live-inspector-body')).toContainText(
    'This app cannot execute or continue tool calls',
  );
  await page.screenshot({ path: 'artifacts/v4/part7c-tools-light.png' });
  await page.locator('#theme').click();
  await page.screenshot({ path: 'artifacts/v4/part7c-tools-dark.png' });
  await page.locator('#live-inspector-body [data-explore-reference]').click();
  await expect(page.locator('#explore-workspace')).toBeVisible();
  await expect(page.locator('#explore-reference')).toContainText('Tool');
  await root(page, 'LIVE').click();
  await expect(page.locator('#live-playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  expect(await page.locator('#live-workspace').getAttribute('data-request-id')).toBe(requestId);
  expect(count).toBe(1);
});

test('streamed function fragments are assembled once, with returned text separate from tool evidence', async ({
  page,
}) => {
  await open(page, true);
  const frames = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'stream_call', type: 'function', function: { name: 'lookup', arguments: '{' } },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"id":2}' } }],
            content: 'Returned explanation',
          },
        },
      ],
    },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  let calls = 0;
  await page.route('https://example.test/**', (r) => {
    calls++;
    return r.fulfill({
      contentType: 'text/event-stream',
      body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n',
    });
  });
  await send(page);
  await expect(page.locator('#live-request-status')).toContainText('completed');
  await page.locator('#live-mode').selectOption('MANUAL');
  await expect(page.locator('#live-response')).toHaveText('Returned explanation');
  await expect(
    page.locator('#live-stages button').filter({ hasText: 'Provider requested a function' }),
  ).toHaveCount(1);
  await expect(page.locator('#live-observations h4')).toHaveCount(1);
  await page.locator('#live-observations details summary').click();
  await expect(page.locator('#live-observations pre')).toHaveText('{"id":2}');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-live-panel=runtime]').click();
  await page.locator('#live-observations h4').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/v4/part7c-tools-mobile.png' });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.locator('#live-observations h4').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/v4/part7c-tools-tablet.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(calls).toBe(1);
});

test('existing user image declarations gate modes, invalidate on identity change and cannot rewrite a running request snapshot', async ({
  page,
}) => {
  await open(page);
  const understanding = page.locator('#live-request-type option[value="IMAGE_UNDERSTANDING"]');
  const generation = page.locator('#live-request-type option[value="IMAGE_GENERATION"]');
  await expect(understanding).toBeDisabled();
  await expect(generation).toBeDisabled();
  await page.locator('#live-settings').click();
  await page.locator('.media-configuration summary').click();
  for (const id of ['imageText', 'imageGeneration', 'generatedMedia'])
    await page.locator(`#provider-media-${id}`).selectOption('UNSUPPORTED');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(understanding).toBeDisabled();
  await expect(generation).toBeDisabled();
  await page.locator('#live-settings').click();
  await page.locator('#provider-generation-model').fill('image-model');
  for (const id of ['imageText', 'imageGeneration', 'generatedMedia'])
    await page.locator(`#provider-media-${id}`).selectOption('SUPPORTED');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(understanding).toBeEnabled();
  await expect(generation).toBeEnabled();
  let pending!: Route;
  await page.route('https://example.test/**', (r) => {
    pending = r;
  });
  // Start a real image-family request so its user-declared profile is captured.
  await page.locator('#live-request-type').selectOption('IMAGE_GENERATION');
  await page.locator('#live-prompt').fill('An image');
  await page.locator('#live-submit').click();
  await expect.poll(() => !!pending).toBe(true);
  await page.locator('#live-mode').selectOption('MANUAL');
  await page.locator('#live-settings').click();
  await page.locator('#provider-url').fill('https://another.test/v1');
  await expect(page.locator('#provider-media-imageGeneration')).toHaveValue('UNKNOWN');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await page.locator('#live-capabilities').locator('..').locator('summary').click();
  await expect(page.locator('#live-capabilities')).toContainText(
    'image generation SUPPORTED (USER_DECLARED)',
  );
  await pending.fulfill({ status: 400, json: { error: { message: 'Mock image rejection' } } });
  await expect(page.locator('#live-request-status')).toContainText('failed');
  await page.locator('#live-stop').click();
  await expect(understanding).toBeDisabled();
  await expect(generation).toBeDisabled();
  await expect(page.locator('#live-request-type option[value="TEXT"]')).toBeEnabled();
});

test('plain text about tools, MCP, RAG and search creates no fake observations or Live usages', async ({
  page,
}) => {
  await open(page);
  await page.route('https://example.test/**', (r) =>
    r.fulfill({
      json: {
        choices: [
          { message: { content: 'A discussion of tools, MCP, search and RAG.' }, finish_reason: 'stop' },
        ],
      },
    }),
  );
  await send(page);
  await expect(page.locator('#live-request-status')).toContainText('completed');
  await expect(page.locator('#live-observations')).toBeHidden();
  await expect(
    page.locator('#live-stages button').filter({ hasText: 'Provider requested a function' }),
  ).toHaveCount(0);
  await expect(page.locator('#live-response')).toContainText('discussion');
});
