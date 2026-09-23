import { test, expect } from '@playwright/test';

test('Manual and Auto share one timeline; detachment survives mode switches', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.clock.install();
  const mode = page.getByLabel('Journey mode', { exact: true });
  const follow = page.locator('.playback');
  await mode.selectOption('MANUAL');
  await page.getByRole('button', { name: 'Start journey', exact: true }).click();
  await page.clock.runFor(3000);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.locator('#play')).toBeDisabled();
  await page.getByRole('button', { name: 'Next stage', exact: true }).click();
  await expect(page.locator('#timeline')).toHaveValue('1');
  await mode.selectOption('AUTO');
  await page.clock.runFor(6100);
  await expect(page.locator('#timeline')).toHaveValue('2');
  await page.mouse.move(12, 400);
  await page.mouse.wheel(0, 120);
  await mode.selectOption('MANUAL');
  await mode.selectOption('AUTO');
  await expect(follow).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.clock.runFor(3000);
  await expect(page.locator('#timeline')).toHaveValue('2');
  await page.getByRole('button', { name: 'Resume focus', exact: true }).click();
  await page.clock.runFor(6100);
  await expect(page.locator('#timeline')).toHaveValue('3');
  await mode.selectOption('MANUAL');
  await page.mouse.move(12, 400);
  await page.mouse.wheel(0, 120);
  await page.getByRole('button', { name: 'Resume focus', exact: true }).click();
  await page.clock.runFor(3000);
  await expect(mode).toHaveValue('MANUAL');
  await expect(page.locator('#timeline')).toHaveValue('3');
  await mode.selectOption('AUTO');
  await page.mouse.move(12, 400);
  await page.mouse.wheel(0, 120);
  await page.getByRole('button', { name: 'Replay journey', exact: true }).click();
  await expect(follow).toHaveAttribute('data-guided-focus', 'TRACKING');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.clock.runFor(6100);
  await expect(page.locator('#timeline')).toHaveValue('1');
});

test('object exploration parks Auto; Resume uses the current stage across a scene boundary', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.clock.install();
  await page.locator('#timeline').fill('3');
  await page.getByRole('button', { name: 'Play journey', exact: true }).click();
  await page.clock.runFor(800);
  await page.locator('.object-label[data-concept="internet"]').click();
  await expect(page.locator('#inspector-header h2')).toHaveText('Internet backbone');
  await expect(page.locator('#timeline')).toHaveValue('3');
  await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('AUTO');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.clock.runFor(5000);
  await expect(page.locator('#timeline')).toHaveValue('3');
  // Explicit Next updates the official subject even while detached.
  await page.getByRole('button', { name: 'Next stage', exact: true }).click();
  await expect(page.locator('#timeline')).toHaveValue('4');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.locator('.object-label[data-concept="gpu"]').click();
  await expect(page.locator('#inspector-header h2')).toHaveText('GPU accelerator');
  await expect(page.locator('#timeline')).toHaveValue('4');
  await page.getByRole('button', { name: 'Resume focus', exact: true }).click();
  await expect(page.locator('#inspector-header h2')).toHaveText('Service ingress');
  await expect(page.locator('.object-label[data-concept="ingress"]')).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(6100);
  await expect(page.locator('#timeline')).toHaveValue('5');
});

test('orbit and panel changes retain tracking; zoom and pan suspend Auto without resetting its timer', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.clock.install();
  const follow = page.locator('.playback');
  await page.locator('#start-tour').click();
  await page.clock.runFor(1500);
  await page.mouse.move(650, 600);
  await page.mouse.down();
  await page.mouse.move(710, 610, { steps: 5 });
  await page.mouse.up();
  await expect(follow).toHaveAttribute('data-guided-focus', 'TRACKING');
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.locator('#restore-inspector').click();
  await expect(follow).toHaveAttribute('data-guided-focus', 'TRACKING');
  await page.mouse.move(650, 600);
  await page.mouse.wheel(0, -160);
  await expect(follow).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.clock.runFor(4000);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.getByRole('button', { name: 'Resume focus', exact: true }).click();
  await page.clock.runFor(4700);
  await expect(page.locator('#timeline')).toHaveValue('1');
  await page.mouse.move(650, 600);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(700, 640, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect(follow).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.clock.runFor(4000);
  await expect(page.locator('#timeline')).toHaveValue('1');
  await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('AUTO');
});

test('Manual Resume returns from an explored scene and reacquires the official subject', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.getByLabel('Journey mode', { exact: true }).selectOption('MANUAL');
  await page.getByLabel('Illustrative compute route', { exact: true }).selectOption('local');
  await page.getByRole('button', { name: 'Start journey', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click();
  await page.locator('.object-label[data-concept="gpu"]').click();
  await expect(page.locator('#scene-title')).toHaveText('On-device compute');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.getByRole('button', { name: 'Resume focus', exact: true }).click();
  await expect(page.locator('#scene-title')).toHaveText('The journey of an AI request');
  await expect(page.locator('#inspector-header h2')).toHaveText('Your device');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(page.getByLabel('Journey mode', { exact: true })).toHaveValue('MANUAL');
  await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
  await expect(page.locator('.object-label[data-concept="device"]')).toHaveAttribute('aria-pressed', 'true');
  // Resume uses the renderer's focus framing, not just a checkbox/selection update.
  const focused = await page.locator('#viewport canvas').screenshot();
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  expect(Buffer.compare(focused, await page.locator('#viewport canvas').screenshot())).not.toBe(0);
});
