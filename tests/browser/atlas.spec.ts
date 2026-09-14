import { test, expect } from '@playwright/test';
test('overview, nested views, search, inspectable branches, and deterministic timeline', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/overview.png' });
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await expect(page.locator('#scene-title')).toHaveText('Inside the model');
  await page.screenshot({ path: 'artifacts/model.png' });
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page.locator('#explode-control')).toBeVisible();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await expect(page.locator('.heatmap')).toBeVisible();
  await page.screenshot({ path: 'artifacts/block.png' });
  await page.getByRole('button', { name: 'Find a concept' }).click();
  await page.getByRole('searchbox', { name: 'Search concepts' }).fill('KV cache');
  await page.getByRole('button', { name: 'KV cache Inside the model' }).click();
  await expect(page.locator('#scene-title')).toHaveText('Inside the model');
  await expect(page.locator('#inspector-header h2')).toHaveText('KV cache');
  await page.getByRole('button', { name: 'Find a concept' }).click();
  await page.getByRole('searchbox', { name: 'Search concepts' }).fill('MCP');
  await page.locator('[data-search-concept="mcp"]').click();
  await expect(page.locator('#scene-title')).toHaveText('Tools & MCP');
  await expect(page.locator('#inspector-header h2')).toHaveText('MCP client & server');
  await page.screenshot({ path: 'artifacts/tools.png' });
  for (const scenario of ['vision', 'diffusion']) {
    await page.getByLabel('Scenario', { exact: true }).selectOption(scenario);
    const target = scenario === 'vision' ? 'patches' : 'denoise';
    await page
      .locator('#stages button')
      .filter({ hasText: scenario === 'vision' ? 'Visual patches' : 'Iterative refinement' })
      .first()
      .click();
    await expect(page.locator('#inspector-header h2')).toHaveText(
      scenario === 'vision' ? 'Visual patches & encoder' : 'Iterative refinement',
    );
    await page.screenshot({ path: `artifacts/${scenario}.png` });
  }
  await page.getByLabel('Scenario', { exact: true }).selectOption('text');
  await page.locator('#timeline').fill('16');
  await expect(page.locator('#current-stage')).toContainText('pass 3');
  await page.locator('#timeline').fill('0');
  await expect(page.locator('#scene-title')).toHaveText('The journey of an AI request');
  await page.getByRole('button', { name: 'Play journey', exact: true }).click();
  await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play journey', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('demo, unicode, sampling, settings and safe persistence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your message' }).fill(' 你好 🌏\n ');
  await page.getByRole('button', { name: 'Run demo', exact: true }).click();
  await expect(page.locator('.message.assistant')).toContainText('Sample response');
  await page.getByRole('button', { name: 'Find a concept' }).click();
  await page.getByRole('searchbox').fill('Tokenisation');
  await page.locator('[data-search-concept="tokenizer"]').click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await expect(page.locator('.input-preview')).toHaveText(' 你好 🌏\n ', { normalizeWhitespace: false });
  await page.getByRole('button', { name: 'Find a concept' }).click();
  await page.getByRole('searchbox').fill('sampling');
  await page.locator('[data-search-concept="sampling"]').click();
  await page.locator('#temperature').fill('0');
  await expect(page.locator('.probability.chosen')).toContainText('blue');
  await expect(page.locator('.probability.chosen')).toContainText('100.0%');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Model identifier', { exact: true }).fill('mock-model');
  await page.getByLabel('API key', { exact: false }).fill('fixture-secret');
  await page.getByRole('button', { name: 'Save connection' }).click();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-secret');
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('API key', { exact: false })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
});
test('mock live cancellation, clear, subsequent run and bounded history', async ({ page }) => {
  let bodies: any[] = [];
  await page.route('**/chat/completions', async (route) => {
    bodies.push(route.request().postDataJSON());
    const content = bodies.length === 1 ? 'old response' : '  New response\n';
    if (bodies.length === 1) await new Promise((r) => setTimeout(r, 600));
    await route
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
      })
      .catch(() => {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Base URL', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('Model identifier', { exact: true }).fill('mock');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Chat mode', { exact: true }).selectOption('live');
  await page.getByRole('textbox', { name: 'Your message' }).fill('first');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your message' }).fill('second');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('#request-status')).toContainText('Response received');
  await expect(page.locator('.message.assistant p')).toHaveText('  New response\n', {
    normalizeWhitespace: false,
  });
  expect(bodies[1].messages.map((m: any) => m.content)).not.toContain('first');
  await page.getByRole('textbox', { name: 'Your message' }).fill('third');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('#request-status')).toContainText('Response received');
  expect(bodies[2].messages.map((m: any) => m.content)).toContain('second');
});
test('mobile, dark, reduced motion and HTML fallback remain navigable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.screenshot({ path: 'artifacts/mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.locator('#journey-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse journey panel' }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.locator('#inspector-panel')).toBeVisible();
  await page.screenshot({ path: 'artifacts/mobile-inspector.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle dark theme' }).click();
  await page.screenshot({ path: 'artifacts/mobile-dark.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: 'artifacts/dark.png' });
  await page.addInitScript(() => {
    const old = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: any, ...args: any[]) {
      if (String(kind).includes('webgl')) return null;
      return (old as any).call(this, kind, ...args);
    } as any;
  });
  await page.reload();
  await expect(page.locator('#fallback')).toBeVisible();
  await page.locator('#fallback-stages button').filter({ hasText: 'GPU accelerator' }).click();
  await expect(page.locator('#inspector-header h2')).toHaveText('GPU accelerator');
});
test('tablet sheets leave the scene clear and remain usable across resizing', async ({ page }) => {
  await page.goto('/');
  for (const viewport of [
    { width: 820, height: 1180 },
    { width: 900, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#journey-panel')).not.toBeVisible();
    await expect(page.locator('#inspector-panel')).not.toBeVisible();
    const canvas = (await page.locator('#viewport canvas').boundingBox())!;
    expect(canvas.width).toBeGreaterThan(viewport.width * 0.9);
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await expect(page.locator('#inspector-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Sources', exact: true }).click();
    await expect(page.locator('#inspector-body a').first()).toBeVisible();
    await page.getByRole('button', { name: 'Journey', exact: true }).click();
    await expect(page.locator('#journey-panel')).toBeVisible();
    await expect(page.locator('#inspector-panel')).not.toBeVisible();
    await page.getByRole('button', { name: 'Collapse journey panel' }).click();
    await expect(page.locator('#journey-panel')).not.toBeVisible();
    await page.locator('.object-label[data-concept="device"]').click();
    await expect(page.locator('#inspector-panel')).toBeVisible();
    await expect(page.locator('#inspector-header h2')).toHaveText('Your device');
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#restore-journey').click();
  await expect(page.locator('#journey-panel')).toBeVisible();
  await expect(page.locator('#inspector-panel')).toBeVisible();
});

test('camera orbit, zoom, focus, labels, local route and playback controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const canvas = page.locator('#viewport canvas'),
    rect = (await canvas.boundingBox())!;
  const before = await canvas.screenshot();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.65, rect.y + rect.height * 0.65, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByLabel('Follow journey', { exact: true })).not.toBeChecked();
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  const orbited = await canvas.screenshot();
  await page.mouse.wheel(0, -180);
  expect(Buffer.compare(orbited, await canvas.screenshot())).not.toBe(0);
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  const reset = await canvas.screenshot();
  await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
  expect(Buffer.compare(reset, await canvas.screenshot())).not.toBe(0);
  await page.getByRole('button', { name: 'Fit scene', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle object labels', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Toggle object labels', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Toggle object labels', exact: true }).click();
  await page.getByLabel('Illustrative compute route', { exact: true }).selectOption('local');
  await expect(page.locator('#stages')).not.toContainText('Internet backbone');
  await expect(page.locator('#scene-subtitle')).toContainText('local route');
  await page.screenshot({ path: 'artifacts/local-route.png' });
  await page.getByRole('button', { name: 'Hardware', exact: true }).click();
  await expect(page.locator('#scene-title')).toHaveText('On-device compute');
  await expect(page.locator('#stages')).not.toContainText('Server rack');
  await expect(page.locator('.object-label[data-concept="rack"]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/local-hardware.png' });
  await page.getByLabel('Illustrative compute route', { exact: true }).selectOption('remote');
  await page.getByLabel('Follow journey', { exact: true }).check();
  await page.getByLabel('Playback speed', { exact: true }).selectOption('2');
  await page.locator('#timeline').fill('15');
  await page.getByRole('button', { name: 'Play journey', exact: true }).click();
  await expect(page.locator('#current-stage')).toHaveText('The response returns', { timeout: 6000 });
  await expect(page.getByRole('button', { name: 'Play journey', exact: true })).toBeVisible({
    timeout: 4000,
  });
  await page.getByRole('button', { name: 'Replay journey', exact: true }).click();
  await expect(page.locator('#current-stage')).toHaveText('Your device');
  await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
});
test('every stage in every story is reachable without network side effects', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') requests.push(r.url());
  });
  await page.goto('/');
  for (const scenario of ['text', 'tools', 'vision', 'diffusion']) {
    await page.getByLabel('Scenario', { exact: true }).selectOption(scenario);
    const max = Number(await page.locator('#timeline').getAttribute('max'));
    for (let i = 0; i <= max; i++) {
      await page.locator('#timeline').fill(String(i));
      await expect(page.locator('#inspector-header h2')).not.toBeEmpty();
      await expect(page.locator('#stages .stage.selected')).toHaveCount(1);
    }
    await expect(page.locator('#inspector-header h2')).toHaveText('The response returns');
  }
  expect(requests).toEqual([]);
});
test('complete playback visits every stage of all four scenarios and stops at the return', async ({
  page,
}) => {
  test.setTimeout(110000);
  // Capture window errors even when the development server handles them before
  // Playwright's pageerror event. Playback must finish without renderer errors.
  await page.addInitScript(() => {
    (window as any).__atlasRuntimeErrors = [];
    window.addEventListener('error', (event) => (window as any).__atlasRuntimeErrors.push(event.message));
  });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') requests.push(request.url());
  });
  await page.goto('/');
  await page.getByLabel('Playback speed', { exact: true }).selectOption('2');
  for (const scenario of ['text', 'tools', 'vision', 'diffusion']) {
    await page.getByLabel('Scenario', { exact: true }).selectOption(scenario);
    const last = Number(await page.locator('#timeline').getAttribute('max'));
    await page.getByRole('button', { name: 'Play journey', exact: true }).click();
    for (let stage = 1; stage <= last; stage++) {
      await expect(page.locator('#timeline')).toHaveValue(String(stage), { timeout: 5000 });
      await expect(page.locator('#stages .stage.selected')).toHaveCount(1);
    }
    await expect(page.getByRole('button', { name: 'Play journey', exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('#scene-title')).toHaveText('The journey of an AI request');
    await expect(page.locator('#current-stage')).toHaveText('The response returns');
  }
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => (window as any).__atlasRuntimeErrors)).toEqual([]);
});

test('mock live errors recover and streamed selected-token identity is visible', async ({ page }) => {
  let calls = 0;
  await page.route('**/chat/completions', async (route) => {
    calls++;
    if (calls === 1)
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Invalid fixture credential' } }),
      });
    const token = {
      token: ' quiet',
      logprob: Math.log(0.1),
      top_logprobs: [
        { token: ' blue', logprob: Math.log(0.7) },
        { token: ' quiet', logprob: Math.log(0.1) },
      ],
    };
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: ' quiet' }, logprobs: { content: [token] }, finish_reason: null }],
        }) +
        '\n\ndata: ' +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
        '\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Base URL', { exact: true }).fill('https://example.test/v1');
  await page.getByLabel('Model identifier', { exact: true }).fill('mock');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Chat mode', { exact: true }).selectOption('live');
  await page.getByRole('textbox', { name: 'Your message' }).fill('first');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('#request-status')).toContainText('Error: 401');
  expect(calls).toBe(1);
  await page.getByRole('textbox', { name: 'Your message' }).fill('second');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('#request-status')).toContainText('Response received');
  await page.locator('.context-details > summary').click();
  await page.locator('#received-data details summary').click();
  await expect(page.locator('.observed-candidate.chosen')).toContainText('quiet');
  await expect(page.locator('.observed-candidate.chosen')).toContainText('10.000%');
  await expect(page.locator('.observed-candidate').first()).toContainText('blue');
  expect(calls).toBe(2);
});
