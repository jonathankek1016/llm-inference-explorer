import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page) {
  const response = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/?calibrate=1');
  await expect(page.locator('#framing-calibration')).toBeVisible();
  const modulePath = (await response).url();
  await page.clock.install();
  await page.evaluate(async (path) => {
    const { AtlasScene } = await import(/* @vite-ignore */ path);
    const original = AtlasScene.prototype.focusJourneySubject;
    AtlasScene.prototype.focusJourneySubject = function (...args: unknown[]) {
      (window as any).__framingScene = this;
      return original.apply(this, args);
    };
  }, modulePath);
  await page.getByRole('button', { name: 'Preview stage in Manual' }).click();
  await page.clock.runFor(2200);
}
const panel = (page: Page) => page.locator('#framing-calibration');
async function edit(page: Page, label: string, value: number) {
  await panel(page).getByRole('spinbutton', { name: label, exact: true }).fill(String(value));
  await page.clock.runFor(2000);
}
async function read(page: Page) {
  return page.evaluate(() => {
    const scene = (window as any).__framingScene;
    return {
      target: scene.controls.target.toArray(),
      direction: scene.camera.position.clone().sub(scene.controls.target).normalize().toArray(),
      zoom: scene.camera.zoom,
      composition: scene.composition.toArray(),
      projection: scene.camera.projectionMatrix.toArray(),
      orthographic: scene.camera.isOrthographicCamera,
      targetScreen: scene.controls.target
        .clone()
        .project(scene.camera)
        .toArray()
        .slice(0, 2)
        .map(
          (n: number, i: number) =>
            (i === 0 ? n * 0.5 + 0.5 : -n * 0.5 + 0.5) * (i === 0 ? innerWidth : innerHeight),
        ),
      scene: scene.sceneId,
    };
  });
}
function near(a: number[], b: number[], digits = 3) {
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i], digits));
}
function unchanged(after: Awaited<ReturnType<typeof read>>, before: Awaited<ReturnType<typeof read>>) {
  // OrbitControls' arithmetic can differ by a final floating-point bit at rest.
  for (const field of ['target', 'direction', 'composition', 'projection', 'targetScreen'] as const)
    near(after[field], before[field], 8);
  expect(after.zoom).toBeCloseTo(before.zoom, 8);
  expect(after.scene).toBe(before.scene);
  expect(after.orthographic).toBe(true);
}
async function capture(page: Page) {
  await panel(page).getByRole('button', { name: 'Capture framing', exact: true }).click();
  return JSON.parse(await panel(page).getByRole('textbox', { name: 'Captured registry data' }).inputValue());
}

test('live calibration edits zoom, anchor, composition and regions; Capture/Reset and Resume use the same profiles', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page);
  await page.mouse.move(12, 350);
  await page.mouse.down();
  await page.mouse.move(45, 390, { steps: 8 });
  await page.mouse.up();
  await page.clock.runFor(1400);
  const before = await read(page);
  await edit(page, 'Guided zoom value', 1.38);
  await edit(page, 'Composition X (px) value', -72);
  await edit(page, 'Composition Y (px) value', 60);
  await edit(page, 'Anchor Y (world) value', 1.15);
  await panel(page).getByLabel('Callout region').selectOption('upper-left');
  await page.clock.runFor(2000);
  const posed = await read(page);
  near(posed.direction, before.direction);
  expect(posed.zoom).toBeCloseTo(1.38, 2);
  near(posed.composition, [-72, 60], 2);
  expect(posed.target[1]).toBeCloseTo(1.15, 2); // Existing focus settles within 0.001 world units.
  expect(posed.orthographic).toBe(true);
  expect(posed.targetScreen[0] - before.targetScreen[0]).toBeCloseTo(-72, 1);
  expect(posed.targetScreen[1] - before.targetScreen[1]).toBeCloseTo(60 - before.composition[1], 1);
  await edit(page, 'Teaching duration (ms)', 8200);
  const data = (await capture(page)).stages['text:cloud:text-0'];
  expect(data.guidedZoom).toBeCloseTo(1.38, 2);
  near(data.compositionOffset, [-72, 60], 1); // Capture records the actual eased pose.
  expect(data.preferredCalloutRegion).toBe('upper-left');
  expect(data.teachingDurationMs).toBe(8200);
  expect(data.cameraOrientation).toBeUndefined();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await panel(page).getByRole('button', { name: 'Copy JSON' }).click();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.stages['text:cloud:text-0'].teachingDurationMs).toBe(8200);
  await page.screenshot({ path: 'artifacts/framing/calibrated-light.png' });
  const settled = await read(page);
  await panel(page).locator('summary').click();
  for (const id of ['collapse-journey', 'collapse-inspector', 'restore-journey', 'restore-inspector']) {
    await page.locator('#' + id).click();
    await page.clock.runFor(100);
    unchanged(await read(page), settled);
  }
  await page.mouse.move(12, 300);
  await page.mouse.wheel(0, 160);
  await page.clock.runFor(500);
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.locator('#resume-focus').click();
  await page.clock.runFor(2200);
  near((await read(page)).composition, [-72, 60], 2);
  expect((await read(page)).zoom).toBeCloseTo(1.38, 2);
  await panel(page).locator('summary').click();
  await panel(page).getByRole('button', { name: 'Reset profile', exact: true }).click();
  await page.clock.runFor(2200);
  expect((await read(page)).zoom).toBeCloseTo(1.65, 2);
  expect((await read(page)).composition[0]).toBeCloseTo(0, 1); // Composition settles within 0.01 CSS px.
  await expect(panel(page).getByLabel('Teaching duration (ms)')).toHaveValue('8200');
  await panel(page).getByRole('button', { name: 'Reset duration' }).click();
  await expect(panel(page).getByLabel('Teaching duration (ms)')).toHaveValue('6000');
});

test('scene-entry shot can capture an orbit, while subsequent same-scene stages preserve the user angle', async ({
  page,
}) => {
  await prepare(page);
  await panel(page).getByRole('combobox', { name: 'Journey stage', exact: true }).selectOption('4');
  await page.clock.runFor(2200);
  await panel(page).getByLabel('Profile scope').selectOption('entry');
  await page.mouse.move(12, 300);
  await page.mouse.down();
  await page.mouse.move(100, 345, { steps: 8 });
  await page.mouse.up();
  await page.clock.runFor(1400);
  const entryDirection = (await read(page)).direction;
  await panel(page).getByRole('button', { name: 'Use current orbit for entry' }).click();
  await edit(page, 'Guided zoom value', 1.22);
  const data = (await capture(page)).sceneEntries.compute;
  expect(data.cameraOrientation).toHaveLength(3);
  expect(data.guidedZoom).toBeCloseTo(1.22, 2);
  await panel(page).getByLabel('Profile scope').selectOption('stage');
  await page.locator('#next').click();
  await page.clock.runFor(2200);
  near((await read(page)).direction, entryDirection);
  await page.locator('#timeline').fill('0');
  await page.clock.runFor(2200);
  await page.locator('#timeline').fill('4');
  await page.clock.runFor(2200);
  near((await read(page)).direction, entryDirection);
  expect((await read(page)).zoom).toBeCloseTo(1.22, 2);
});

test('authored timing drives Auto at the existing speed and Settings preserves remaining teaching time', async ({
  page,
}) => {
  await prepare(page);
  await edit(page, 'Teaching duration (ms)', 8000);
  await page.getByLabel('Playback speed', { exact: true }).selectOption('2');
  await page.getByLabel('Journey mode', { exact: true }).selectOption('AUTO');
  await page.clock.runFor(1200);
  await page.locator('#settings-open').click();
  await page.clock.fastForward(30000);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.keyboard.press('Escape');
  await page.clock.runFor(2500);
  await expect(page.locator('#timeline')).toHaveValue('0');
  await page.clock.runFor(400);
  await expect(page.locator('#timeline')).toHaveValue('1');
});

test('normal development UI has no calibration panel and preview drafts are discarded on reload', async ({
  page,
}) => {
  await prepare(page);
  await edit(page, 'Guided zoom value', 1.1);
  await page.reload();
  await expect(panel(page).getByRole('spinbutton', { name: 'Guided zoom value' })).toHaveValue('1.65');
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`${theme} authoring visual review poses representative stages, regions and entry shots without source edits`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page);
    if (theme === 'dark') await page.locator('#theme').click();
    await page.locator('#appearance-open').click();
    await page.getByRole('radio', { name: 'Soft Lavender', exact: true }).check();
    await page.keyboard.press('Escape');
    for (const [name, index, zoom, region] of [
      ['overview', 0, 1.38, 'upper-left'],
      ['hardware', 6, 1.35, 'upper-right'],
      ['model', 11, 1.15, 'above'],
    ] as const) {
      await panel(page)
        .getByRole('combobox', { name: 'Journey stage', exact: true })
        .selectOption(String(index));
      await page.clock.runFor(1800);
      await panel(page).getByRole('slider', { name: 'Guided zoom', exact: true }).fill(String(zoom));
      await panel(page).getByRole('slider', { name: 'Composition X (px)', exact: true }).fill('-90');
      await panel(page).getByRole('slider', { name: 'Composition Y (px)', exact: true }).fill('20');
      await panel(page).getByRole('combobox', { name: 'Callout region' }).selectOption(region);
      await page.clock.runFor(2000);
      await expect(page.locator('.world-callout[data-role="guided"]')).toBeVisible();
      const captured = await capture(page);
      expect(captured.stages[`text:cloud:text-${index}`].preferredCalloutRegion).toBe(region);
      await page.screenshot({ path: `artifacts/framing/${theme}-${name}-authoring.png` });
      await panel(page).locator('summary').click();
      await page.screenshot({ path: `artifacts/framing/${theme}-${name}.png` });
      // Both open, each collapsed, restored: composition is unchanged.
      const posed = await read(page);
      for (const id of ['collapse-journey', 'restore-journey', 'collapse-inspector', 'restore-inspector']) {
        await page.locator('#' + id).click();
        await page.clock.runFor(100);
        unchanged(await read(page), posed);
      }
      await panel(page).locator('summary').click();
    }
    await panel(page).locator('summary').click();
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    for (const subject of ['attention', 'mlp']) {
      await page.locator(`.object-label[data-concept="${subject}"]`).first().focus();
      await page.keyboard.press('Enter');
    }
    await page.screenshot({ path: `artifacts/framing/${theme}-block-exploration.png` });
    await page.locator('#resume-focus').click();
    await page.clock.runFor(2200);
    expect((await read(page)).scene).toBe('model');
    expect((await read(page)).zoom).toBeCloseTo(1.15, 2);
    await page.screenshot({ path: `artifacts/framing/${theme}-resume.png` });
  });
}
