import { test, expect } from '@playwright/test';

test('dark appearance autosaves, survives dismissal and reload, and never changes light mode', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.object-label').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const open = () => page.getByRole('button', { name: 'Settings', exact: true }).click();
  const close = () => page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const depth = page.getByRole('slider', { name: 'Dark appearance', exact: true });
  const grid = page.getByRole('slider', { name: 'Grid intensity', exact: true });
  const canvasColour = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--canvas'));
  const tokens = () => page.evaluate(() => document.documentElement.style.cssText);
  await open();
  await expect(depth).toBeDisabled();
  await expect(depth).toHaveValue('0');
  await expect(page.locator('#dark-appearance-mode-note')).toBeVisible();
  await close();
  await page.mouse.click(2, 2);
  const lightTokens = await tokens();
  const surfaces = () =>
    page
      .locator(
        '#app, .masthead, .scene-intro, .panel, .stage, .object-label, .viewport-toolbar, #scene-switcher, .play-button, .scenario-control, .search-trigger',
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const css = getComputedStyle(node),
            rect = node.getBoundingClientRect();
          return {
            text: css.color,
            background: css.background,
            border: css.border,
            shadow: css.boxShadow,
            filter: css.backdropFilter,
            font: css.font,
            scheme: css.colorScheme,
            bounds: [rect.x, rect.y, rect.width, rect.height],
          };
        }),
      );
  const lightSurfaces = await surfaces();
  await page.locator('#theme').click();
  expect(await canvasColour()).toBe('#202228');
  await open();
  await expect(depth).toBeEnabled();
  await expect(page.locator('#dark-appearance-mode-note')).toBeHidden();
  await page.locator('#provider-url').fill('invalid-url');
  await page.locator('#provider-model').fill('');
  await depth.press('End');
  await expect(depth).toHaveValue('100');
  expect(await canvasColour()).toBe('#101217');
  expect(await page.evaluate(() => localStorage.getItem('atlas-dark-appearance'))).toBe('100');
  expect(await page.evaluate(() => localStorage.getItem('atlas-provider'))).toBeNull();
  await depth.press('ArrowLeft');
  await expect(depth).toHaveValue('99');
  await depth.press('End');
  await grid.fill('80');
  expect(await canvasColour()).toBe('#101217');
  await page.getByLabel('Show ground grid', { exact: true }).uncheck();
  await expect(grid).toBeDisabled();
  await expect(depth).toBeEnabled();
  await page.mouse.click(2, 2);
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await page.reload();
  await page.locator('.object-label').first().waitFor();
  expect(await canvasColour()).toBe('#101217');
  await open();
  await expect(depth).toHaveValue('100');
  await expect(grid).toHaveValue('80');
  await expect(grid).toBeDisabled();
  await page.getByLabel('Show ground grid', { exact: true }).check();
  await grid.fill('25');
  await depth.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  expect(await canvasColour()).toBe('#101217');
  await page.locator('#theme').click();
  await page.mouse.click(2, 2);
  expect(await tokens()).toBe(lightTokens);
  expect(await surfaces()).toEqual(lightSurfaces);
  await open();
  await expect(depth).toBeDisabled();
  await expect(depth).toHaveValue('100');
  await close();
  await page.reload();
  await open();
  await expect(depth).toBeDisabled();
  await expect(depth).toHaveValue('100');
  await close();
  await page.locator('#theme').click();
  expect(await canvasColour()).toBe('#101217');
  await open();
  await expect(depth).toHaveValue('100');
  await depth.press('Home');
  expect(await canvasColour()).toBe('#202228');
  await expect(page.locator('#dark-appearance-value')).toHaveText('Default');
});
