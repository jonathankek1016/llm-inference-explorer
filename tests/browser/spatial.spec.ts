import { test, expect } from '@playwright/test';

test('full-window world retains framing and grid preference without changing the journey', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.locator('#viewport canvas');
  await expect(canvas).toBeVisible();
  const layout = () =>
    page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        canvas: rect('#viewport canvas'),
        panels: ['#journey-panel', '#inspector-panel', '.playback'].map(rect),
        headerBorder: getComputedStyle(document.querySelector('.masthead')!).borderBottomWidth,
      };
    });
  const original = await layout();
  expect(original.canvas).toEqual({ x: 0, y: 0, ...page.viewportSize() });
  expect(original.headerBorder).toBe('0px');
  await page.locator('#timeline').fill('3');
  await page.mouse.move(12, 400);
  await page.mouse.wheel(0, 120);
  const withGrid = await canvas.screenshot();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByLabel('Show ground grid', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  expect(Buffer.compare(withGrid, await canvas.screenshot())).not.toBe(0);
  expect((await layout()).panels).toEqual(original.panels);
  await expect(page.locator('#timeline')).toHaveValue('3');
  await expect(page.locator('#inspector-header h2')).toHaveText('Data centre');
  // Guided framing can put the laptop beneath the Journey panel. Expose the
  // actual mesh before raycasting; collapsing the panel must not move it.
  await page.locator('#collapse-journey').click();
  const device = (await page.locator('.object-label[data-concept="device"]').boundingBox())!;
  // Hit the laptop mesh below its label, exercising the full-canvas raycast.
  await page.mouse.click(device.x + device.width / 2, device.y + device.height + 35);
  await expect(page.locator('#inspector-header h2')).toHaveText('Your device');
  // Settings is the sole home for this preference; no provider configuration needed.
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Show ground grid', { exact: true })).not.toBeChecked();
  await page.getByLabel('Show ground grid', { exact: true }).check();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle dark theme', exact: true }).click();
  // Orbit from outside the former central viewport: the background itself is interactive.
  await page.locator('#timeline').fill('0');
  await page.mouse.move(12, 400);
  await page.mouse.down();
  await page.mouse.move(24, 460, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  const orbited = await canvas.screenshot();
  // Stay on exposed canvas: projected labels can cover the old centre point.
  await page.mouse.move(12, 500);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(24, 560, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  expect(Buffer.compare(orbited, await canvas.screenshot())).not.toBe(0);
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Show ground grid', { exact: true })).toBeChecked();
  await page.getByLabel('Show ground grid', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  expect((await layout()).canvas).toEqual({ x: 0, y: 0, width: 390, height: 844 });
});
