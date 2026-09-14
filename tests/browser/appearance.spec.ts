import { test, expect } from '@playwright/test';

test('palettes update the current scene, persist, and preserve playback and neutral dark surfaces', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sage');
  await page.locator('#timeline').fill('3');
  const canvasBefore = await page.locator('#viewport canvas').screenshot();
  await page.getByRole('button', { name: 'Colour palette', exact: true }).click();
  await page.getByRole('radio', { name: 'Dusty Rose', exact: true }).check();
  await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
  expect(Buffer.compare(canvasBefore, await page.locator('#viewport canvas').screenshot())).not.toBe(0);
  await expect(page.locator('#timeline')).toHaveValue('3');
  await expect(page.locator('#inspector-header h2')).toHaveText('Data centre');
  await page.getByRole('button', { name: 'Play journey', exact: true }).click();
  await page.getByRole('button', { name: 'Colour palette', exact: true }).click();
  await page.getByRole('radio', { name: 'Powder Blue', exact: true }).check();
  await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause journey', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause journey', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle dark theme', exact: true }).click();
  const foundation = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim());
  expect(await foundation()).toBe('#202228');
  await page.getByRole('button', { name: 'Colour palette', exact: true }).click();
  await page.getByRole('radio', { name: 'Custom accent', exact: true }).check();
  await page.getByRole('textbox', { name: 'Accent hex colour', exact: true }).fill('#ffdd00');
  await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
  expect(await foundation()).toBe('#202228');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'custom');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Colour palette', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Accent hex colour', exact: true })).toHaveValue('#ffdd00');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByRole('button', { name: 'Colour palette', exact: true }).click();
  await page.getByRole('radio', { name: 'Original Sage', exact: true }).check();
  await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sage');
  expect(errors).toEqual([]);
});

test('in-app picker supports live pointer, keyboard and HEX edits with persistent dismissal', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = page.locator('#appearance-dialog');
  const open = () => page.getByRole('button', { name: 'Colour palette', exact: true }).click();
  const hex = page.getByRole('textbox', { name: 'Accent hex colour', exact: true });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlas-appearance')!).custom);
  await open();
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(dialog.locator('input[type="color"]')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Custom accent', exact: true }).check();
  await hex.fill('#ff0000');
  await expect(page.getByRole('slider', { name: 'Hue', exact: true })).toHaveValue('0');
  const hue = page.getByRole('slider', { name: 'Hue', exact: true });
  await hue.fill('240');
  await expect(hex).toHaveValue('#0000ff');
  expect(await saved()).toBe('#0000ff');
  // Native range semantics expose both shade axes to keyboard and assistive technology.
  const saturation = page.getByRole('slider', { name: 'Saturation', exact: true });
  const brightness = page.getByRole('slider', { name: 'Brightness', exact: true });
  await saturation.focus();
  await saturation.press('Home');
  await expect(hex).toHaveValue('#ffffff');
  expect(await page.locator('#colour-plane').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
    'solid',
  );
  await saturation.press('End');
  await expect(hex).toHaveValue('#0000ff');
  await saturation.press('Tab');
  await expect(brightness).toBeFocused();
  await brightness.press('Home');
  await expect(hex).toHaveValue('#000000');
  await brightness.press('End');
  await expect(hex).toHaveValue('#0000ff');
  await brightness.press('Tab');
  await expect(hue).toBeFocused();
  await hue.press('ArrowRight');
  await expect(hex).not.toHaveValue('#0000ff');
  await hex.fill('#gggggg');
  await expect(hex).toHaveAttribute('aria-invalid', 'true');
  expect(await saved()).not.toBe('#gggggg');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await open();
  await expect(hex).toHaveValue(await saved());
  await expect(hex).toHaveAttribute('aria-invalid', 'false');
  await hex.fill('#ff0000');
  const plane = page.locator('#colour-plane');
  await plane.scrollIntoViewIfNeeded();
  let rect = (await plane.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * 0.5, rect.y + rect.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.3, { steps: 5 });
  const duringDrag = await saved();
  expect(duringDrag).not.toBe('#ff0000');
  await page.mouse.move(rect.x + rect.width + 100, rect.y + rect.height + 100);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(hex).toHaveValue('#000000');
  await hex.fill('#db7762');
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'custom');
  await page.reload();
  await open();
  await expect(hex).toHaveValue('#db7762');
  await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
  await page.locator('#theme').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  await hex.fill('#75618f');
  await page.mouse.click(389, 422);
  await expect(dialog).not.toBeVisible();
  await open();
  await expect(hex).toHaveValue('#75618f');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await saved()).toBe('#75618f');
});
