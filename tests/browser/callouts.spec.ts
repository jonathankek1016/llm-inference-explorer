import { test, expect, type Page } from '@playwright/test';
import { palettes, contrast, mix } from '../../src/theme.ts';

async function prepare(page: Page, start = true) {
  const response = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const modulePath = (await response).url();
  await page.clock.install();
  await page.evaluate(async (modulePath) => {
    const { AtlasScene } = await import(/* @vite-ignore */ modulePath);
    const original = AtlasScene.prototype.setCallouts;
    AtlasScene.prototype.setCallouts = function (...args: unknown[]) {
      (window as any).__calloutScene = () => ({
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
        zoom: this.camera.zoom,
        projection: this.camera.projectionMatrix.toArray(),
        orthographic: this.camera.isOrthographicCamera,
        scene: this.sceneId,
        anchors: this.nodes.map((node: any) => {
          const p = node.anchor.clone().project(this.camera);
          const hit = node.group.position.clone();
          hit.y += 0.55;
          hit.project(this.camera);
          return {
            id: node.id,
            x: (p.x * 0.5 + 0.5) * innerWidth,
            y: (-p.y * 0.5 + 0.5) * innerHeight,
            hitX: (hit.x * 0.5 + 0.5) * innerWidth,
            hitY: (-hit.y * 0.5 + 0.5) * innerHeight,
          };
        }),
      });
      return original.apply(this, args);
    };
  }, modulePath);
  await page.getByLabel('Journey mode', { exact: true }).selectOption('MANUAL');
  if (start) {
    await page.locator('#start-tour').click();
    await page.clock.runFor(1800);
  }
}
const guided = (page: Page) => page.locator('.world-callout[data-role="guided"]');
const explorer = (page: Page, id: string) => page.locator(`.world-callout[data-callout-id="explore-${id}"]`);
const camera = (page: Page) => page.evaluate(() => (window as any).__calloutScene());
async function label(page: Page, id: string) {
  // Keyboard selection remains available even when a callout overlaps the label.
  await page.locator(`.object-label[data-concept="${id}"]`).first().focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(64);
}
async function projected(page: Page, id: string) {
  const { current, points } = await page.evaluate(() => {
    const line = document.querySelector('.callout-leaders line')!;
    return {
      current: (window as any).__calloutScene(),
      points: [Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))],
    };
  });
  const anchor = current.anchors.find((a: any) => a.id === id);
  // OrbitControls can settle below its redraw threshold; keep subpixel tolerance.
  expect(points[0]).toBeCloseTo(anchor.x, 0);
  expect(points[1]).toBeCloseTo(anchor.y, 0);
  expect(current.orthographic).toBe(true);
  return points;
}

test('one canonical card follows Start, Next, Previous, Auto and restart with authored content', async ({
  page,
}) => {
  await prepare(page, false);
  await expect(guided(page)).toHaveCount(0);
  await page.locator('#start-tour').click();
  await expect(guided(page)).toHaveCount(1);
  await expect(guided(page)).toContainText('1 / 18');
  await expect(guided(page)).toContainText('Your device');
  await expect(guided(page)).toContainText('When you press Enter');
  await page.locator('#next').click();
  await expect(guided(page)).toHaveCount(1);
  await expect(guided(page)).toContainText('2 / 18');
  await expect(guided(page)).toContainText('Wi-Fi & router');
  await page.locator('#previous').click();
  await expect(guided(page)).toContainText('1 / 18');
  await page.getByLabel('Journey mode', { exact: true }).selectOption('AUTO');
  await page.clock.runFor(6200);
  await expect(guided(page)).toContainText('2 / 18');
  await page.locator('#replay').click();
  await expect(guided(page)).toHaveCount(1);
  await expect(guided(page)).toContainText('1 / 18');
});

test('projection follows orbit, zoom, pan and eased guided transitions on the orthographic camera', async ({
  page,
}) => {
  await prepare(page);
  const initial = await projected(page, 'device');
  await page.mouse.move(12, 400);
  await page.mouse.down();
  await page.mouse.move(65, 450, { steps: 8 });
  await page.mouse.up();
  await page.clock.runFor(1200);
  expect(await projected(page, 'device')).not.toEqual(initial);
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  await page.locator('#next').click();
  await page.clock.runFor(100);
  const inMotion = await projected(page, 'router');
  await page.clock.runFor(1800);
  expect(await projected(page, 'router')).not.toEqual(inMotion);
  await page.mouse.move(12, 500);
  await page.mouse.wheel(0, 140);
  await page.clock.runFor(400);
  const zoomed = await projected(page, 'router');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(65, 540, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.clock.runFor(400);
  expect(await projected(page, 'router')).not.toEqual(zoomed);
});

test('exploration cards coexist, deduplicate, close independently and return with their scene', async ({
  page,
}) => {
  await prepare(page, false);
  await label(page, 'router');
  await label(page, 'internet');
  await expect(explorer(page, 'router')).toBeVisible();
  await expect(explorer(page, 'internet')).toBeVisible();
  await label(page, 'router');
  await expect(page.locator('.world-callout')).toHaveCount(2);
  await expect(guided(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Hardware', exact: true }).click();
  await expect(explorer(page, 'router')).toBeHidden();
  await expect(explorer(page, 'internet')).toBeHidden();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(explorer(page, 'router')).toBeVisible();
  await expect(explorer(page, 'internet')).toBeVisible();
  await explorer(page, 'router').getByRole('button', { name: 'Close Wi-Fi & router callout' }).click();
  await expect(explorer(page, 'router')).toHaveCount(0);
  await expect(explorer(page, 'internet')).toBeVisible();
});

test('detachment, Resume, Settings and panels retain cards without redefining the official stage', async ({
  page,
}) => {
  await prepare(page);
  await label(page, 'router');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
  await expect(page.locator('#timeline')).toHaveValue('0');
  await expect(guided(page)).toHaveAttribute('data-subject', 'device');
  await expect(explorer(page, 'router')).toHaveCount(1);
  await page.locator('#resume-focus').click();
  await page.clock.runFor(1800);
  await expect(guided(page)).toBeVisible();
  await expect(explorer(page, 'router')).toHaveCount(1);
  const before = await camera(page);
  for (const id of ['collapse-inspector', 'collapse-journey', 'restore-journey', 'restore-inspector']) {
    await page.locator('#' + id).click();
    await page.clock.runFor(64);
    expect(await camera(page)).toEqual(before);
  }
  await guided(page).evaluate((card) => ((window as any).__guidedCard = card));
  await page.locator('#settings-open').click();
  const frozen = await guided(page).getAttribute('style');
  await page.clock.fastForward(30000);
  expect(await guided(page).getAttribute('style')).toBe(frozen);
  await page.keyboard.press('Escape');
  expect(await guided(page).evaluate((card) => card === (window as any).__guidedCard)).toBe(true);
  await expect(explorer(page, 'router')).toHaveCount(1);
});

test('all authored scenarios resolve real anchors; missing subjects use scene context without a leader', async ({
  page,
}) => {
  test.setTimeout(90000);
  await prepare(page);
  for (const scenario of ['text', 'tools', 'vision', 'diffusion']) {
    await page.locator('#scenario').selectOption(scenario);
    const count = Number(await page.locator('#timeline').getAttribute('max')) + 1;
    for (let index = 0; index < count; index++) {
      await page.locator('#timeline').fill(String(index));
      await page.clock.runFor(1500);
      await expect(guided(page)).toHaveCount(1);
      const subject = await guided(page).getAttribute('data-subject');
      const hasAnchor = (await camera(page)).anchors.some((node: any) => node.id === subject);
      await expect(guided(page)).toHaveAttribute('data-anchored', String(hasAnchor));
      if (!hasAnchor) {
        await expect(guided(page)).toBeVisible();
        await expect(guided(page)).toContainText('Scene context');
        await expect(page.locator('.callout-leaders line')).toBeHidden();
      }
    }
  }
});

for (const theme of ['light', 'dark']) {
  test(`${theme} callout visual review across scenes, panels and exploration`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page);
    if (theme === 'dark') await page.locator('#theme').click();
    for (const [name, index] of [
      ['overview', 0],
      ['hardware', 6],
      ['model', 11],
    ] as const) {
      await page.locator('#timeline').fill(String(index));
      await page.clock.runFor(1800);
      await expect(guided(page)).toBeVisible();
      await page.screenshot({ path: `artifacts/callouts/${theme}-${name}.png` });
      if (name === 'overview') {
        for (const direction of [-1, 1]) {
          await page.mouse.move(12, 400);
          await page.mouse.down();
          await page.mouse.move(12 + 10 * direction, 445, { steps: 8 });
          await page.mouse.up();
          await page.clock.runFor(1000);
          await page.screenshot({ path: `artifacts/callouts/${theme}-orbit-${direction}.png` });
        }
        for (const zoom of [-140, 140]) {
          await page.mouse.move(12, 500);
          await page.mouse.wheel(0, zoom);
          await page.clock.runFor(400);
          await page.screenshot({ path: `artifacts/callouts/${theme}-zoom-${zoom}.png` });
        }
        await page.locator('#resume-focus').click();
        await page.clock.runFor(1800);
      }
    }
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await label(page, 'attention');
    await label(page, 'mlp');
    await page.screenshot({ path: `artifacts/callouts/${theme}-block-exploration.png` });
    await page.locator('#resume-focus').click();
    await page.clock.runFor(1800);
    await expect(guided(page)).toBeVisible();
    await expect(explorer(page, 'attention')).toBeHidden();
    await page.locator('#timeline').fill('0');
    await page.clock.runFor(1800);
    await label(page, 'router');
    await page.locator('#collapse-inspector').click();
    await page.locator('#collapse-journey').click();
    await page.screenshot({ path: `artifacts/callouts/${theme}-detached.png` });
    await page.locator('#resume-focus').click();
    await page.clock.runFor(1800);
    await page.screenshot({ path: `artifacts/callouts/${theme}-resumed.png` });
  });
}

test('canvas picking opens independent cards and local-route subjects keep valid anchors', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, false);
  const router = (await camera(page)).anchors.find((anchor: any) => anchor.id === 'router');
  await page.mouse.click(router.hitX, router.hitY);
  await expect(explorer(page, 'router')).toBeVisible();
  await expect(page.locator('#inspector-header h2')).toHaveText('Wi-Fi & router');
  await page.screenshot({ path: 'artifacts/callouts/single-exploration.png' });
  await page.locator('#route').selectOption('local');
  await page.locator('#start-tour').click();
  await page.clock.runFor(1800);
  await expect(explorer(page, 'router')).toBeHidden();
  for (const index of [0, 1, 2, 7, 12]) {
    await page.locator('#timeline').fill(String(index));
    await page.clock.runFor(1800);
    await expect(guided(page)).toHaveAttribute('data-anchored', 'true');
  }
});

test('callouts inherit readable palette tokens, retain keyboard controls and fit responsive shells', async ({
  page,
}) => {
  test.setTimeout(60000);
  await prepare(page);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme').click();
    for (const palette of [...palettes, { id: 'custom', name: 'Custom accent' }]) {
      await page.locator('#appearance-open').click();
      await page.getByRole('radio', { name: palette.name, exact: true }).check();
      if (palette.id === 'custom')
        await page.getByRole('textbox', { name: 'Accent hex colour', exact: true }).fill('#ffdd00');
      await page.keyboard.press('Escape');
      const colours = await guided(page).evaluate((card) => {
        const root = getComputedStyle(document.documentElement);
        const hex = (css: string) => {
          const rgb = css
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
          return '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');
        };
        return {
          panel: root.getPropertyValue('--panel-solid').trim(),
          text: ['h2', 'p', '.callout-status', '.callout-inspect'].map((selector) =>
            hex(getComputedStyle(card.querySelector(selector)!).color),
          ),
        };
      });
      const backing = mix(
        colours.panel,
        theme === 'dark' ? '#ffffff' : '#000000',
        theme === 'dark' ? 0.07 : 0.09,
      );
      for (const colour of colours.text) expect(contrast(colour, backing)).toBeGreaterThanOrEqual(4.5);
      if (palette.id === 'lavender')
        await page.screenshot({ path: `artifacts/callouts/${theme}-lavender.png` });
    }
  }
  await guided(page).getByRole('button', { name: 'Read in Inspector' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
  for (const [width, height] of [
    [1440, 960],
    [1024, 768],
    [820, 1180],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(80);
    const box = await guided(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});

test('a pre-opened reference stays distinct from the guided card for the same subject', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page, false);
  await label(page, 'device');
  await page.locator('#start-tour').click();
  await page.clock.runFor(1800);
  await expect(guided(page)).toBeVisible();
  await expect(explorer(page, 'device')).toBeVisible();
  const lesson = (await guided(page).boundingBox())!;
  const reference = (await explorer(page, 'device').boundingBox())!;
  expect(reference.y).toBeGreaterThan(lesson.y + lesson.height);
  await expect(guided(page)).toContainText('Journey');
  await expect(explorer(page, 'device')).toContainText('Exploring');
  await page.screenshot({ path: 'artifacts/callouts/shared-subject.png' });
  await explorer(page, 'device').getByRole('button', { name: 'Close Your device callout' }).click();
  await expect(guided(page)).toBeVisible();
  await expect(explorer(page, 'device')).toHaveCount(0);
});
