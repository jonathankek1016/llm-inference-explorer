import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('existing saved grid intensities are respected without a default migration', async ({ page }) => {
  await page.goto('/');
  for (const saved of [0, 50, 100]) {
    await page.evaluate((value) => localStorage.setItem('atlas-grid-intensity', String(value)), saved);
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Grid intensity', exact: true })).toHaveValue(
      String(saved),
    );
    await expect(page.locator('#grid-intensity-value')).toHaveText(`${saved}%`);
    expect(await page.evaluate(() => localStorage.getItem('atlas-grid-intensity'))).toBe(String(saved));
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
});

test('display intensity autosaves independently and outside dismissal discards connection drafts', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = page.locator('#settings-dialog');
  const intensity = page.getByRole('slider', { name: 'Grid intensity', exact: true });
  const open = () => page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.object-label').first().waitFor();
  await open();
  await expect(intensity).toHaveValue('25');
  await page.locator('#provider-url').fill('https://example.com/v1');
  await page.locator('#provider-model').fill('saved-model');
  await page.locator('#provider-key').fill('fixture-memory-key');
  await page.locator('#provider-stream').uncheck();
  await page.locator('#provider-logprobs').check();
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('atlas-provider'));
  await open();
  await page.locator('#provider-url').fill('invalid-url');
  await page.locator('#provider-model').fill('');
  await page.locator('#provider-key').fill('unsaved-secret');
  await page.locator('#provider-stream').check();
  await page.locator('#provider-logprobs').uncheck();
  await intensity.fill('80');
  await intensity.press('ArrowLeft');
  await expect(page.locator('#grid-intensity-value')).toHaveText('79%');
  expect(await page.evaluate(() => localStorage.getItem('atlas-grid-intensity'))).toBe('79');
  expect(await page.evaluate(() => localStorage.getItem('atlas-provider'))).toBe(saved);
  // Interior panel padding must remain inert, as must a drag ending outside.
  let rect = (await dialog.boundingBox())!;
  await page.mouse.click(rect.x + 8, rect.y + 8);
  await expect(dialog).toBeVisible();
  await page.mouse.move(rect.x + 8, rect.y + 8);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#provider-key')).toHaveValue('');
  await open();
  await expect(page.locator('#provider-url')).toHaveValue('https://example.com/v1');
  await expect(page.locator('#provider-model')).toHaveValue('saved-model');
  await expect(page.locator('#provider-key')).toHaveValue('fixture-memory-key');
  await expect(page.locator('#provider-stream')).not.toBeChecked();
  await expect(page.locator('#provider-logprobs')).toBeChecked();
  await expect(intensity).toHaveValue('79');
  await page.getByLabel('Show ground grid', { exact: true }).uncheck();
  await expect(intensity).toBeDisabled();
  await expect(intensity).toHaveValue('79');
  await page.reload();
  await open();
  await expect(intensity).toBeDisabled();
  await expect(intensity).toHaveValue('79');
  await expect(page.locator('#provider-key')).toHaveValue('');
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toContain('fixture-memory-key');
  expect(storage).not.toContain('unsaved-secret');
  await page.getByLabel('Show ground grid', { exact: true }).check();
  await expect(intensity).toBeEnabled();
  await expect(intensity).toHaveValue('79');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const canvas = page.locator('#viewport canvas');
  const renderedCanvas = async () => {
    await page.evaluate(() => document.fonts.ready);
    // Settings updates mark WebGL dirty. Screenshot capture does not itself
    // guarantee that the renderer has painted the newly requested grid state.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    return canvas.screenshot();
  };
  const labels = () =>
    page
      .locator('.object-label')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).style.transform));
  const beforeLabels = await labels();
  const before = await renderedCanvas();
  await open();
  await intensity.fill('0');
  await page.mouse.click(2, 2);
  const zero = await renderedCanvas();
  expect(Buffer.compare(before, zero)).not.toBe(0);
  expect(await labels()).toEqual(beforeLabels);
  await open();
  await page.getByLabel('Show ground grid', { exact: true }).uncheck();
  await page.mouse.click(2, 2);
  const hiddenGrid = await renderedCanvas();
  const difference = await page.evaluate(
    async (images) => {
      const pixels = await Promise.all(
        images.map(async (encoded) => {
          const image = new Image();
          image.src = `data:image/png;base64,${encoded}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        }),
      );
      let changed = 0,
        maximum = 0;
      for (let i = 0; i < pixels[0].length; i += 4) {
        let delta = 0;
        for (let channel = 0; channel < 4; channel++)
          delta = Math.max(delta, Math.abs(pixels[0][i + channel] - pixels[1][i + channel]));
        if (delta) changed++;
        maximum = Math.max(maximum, delta);
      }
      return { changed, maximum };
    },
    [zero.toString('base64'), hiddenGrid.toString('base64')],
  );
  // A repeated GPU draw can round one edge pixel by one 8-bit channel step.
  // Keep a strict pixel budget rather than requiring identical PNG bytes.
  if (difference.changed > 4 || difference.maximum > 1) {
    for (const [name, body] of [
      ['zero-intensity', zero],
      ['hidden-grid', hiddenGrid],
    ] as const) {
      const path = test.info().outputPath(`${name}.png`);
      await writeFile(path, body);
      await test.info().attach(name, { path, contentType: 'image/png' });
    }
  }
  expect(difference.changed).toBeLessThanOrEqual(4);
  expect(difference.maximum).toBeLessThanOrEqual(1);
  await open();
  await page.getByLabel('Show ground grid', { exact: true }).check();
  await intensity.fill('100');
  await page.mouse.click(2, 2);
  expect(Buffer.compare(zero, await renderedCanvas())).not.toBe(0);
  await page.locator('#theme').click();
  await open();
  await expect(intensity).toHaveValue('100');
  await page.mouse.click(2, 2);
  // Exercise all four outside margins at phone size.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [x, y] of [
    [1, 422],
    [389, 422],
    [195, 1],
    [195, 843],
  ]) {
    await open();
    await page.mouse.click(x, y);
    await expect(dialog).not.toBeVisible();
  }
});
