import { test, expect, type Page } from '@playwright/test';

const root = (page: Page, id: string) => page.locator(`.workspace-nav [data-workspace="${id}"]`);
async function prepare(page: Page) {
  const response = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.clock.install();
  await page.evaluate(
    async (url) => {
      const { AtlasScene } = await import(/* @vite-ignore */ url);
      const original = AtlasScene.prototype.setVisible;
      (window as any).__visuals = {};
      AtlasScene.prototype.setVisible = function (visible: boolean) {
        const id = this.renderer.domElement.parentElement.id;
        (window as any).__visuals[id] = this;
        original.call(this, visible);
      };
    },
    (await response).url(),
  );
}
async function select(page: Page, id: string) {
  await page.locator('#search-open').click();
  await page.locator('#search-input').fill(id);
  await page.locator(`[data-search-concept="${id}"]`).click();
  await page.clock.runFor(1600);
}
const visual = (page: Page, id: string) =>
  page.evaluate((id) => {
    const scene = (window as any).__visuals[id];
    return {
      camera: JSON.parse(
        JSON.stringify(scene.captureView(), (_key, value) =>
          typeof value === 'number' ? Number(value.toFixed(7)) : value,
        ),
      ),
      scene: scene.sceneId,
      selected: scene.selected,
      phase: scene.packetElapsed,
      packet: scene.packet.uuid,
      flow: scene.flowActive,
      particleVisible: scene.packet.visible,
      emphasis: scene.emphasis.effects.map((e: any) => [e.owner ?? '', Number(e.amount.value.toFixed(4))]),
    };
  }, id);

function expectCameraClose(actual: any, expected: any) {
  expect(actual.zoom).toBeCloseTo(expected.zoom, 6);
  for (const key of ['position', 'target', 'composition'])
    actual[key].forEach((value: number, index: number) => expect(value).toBeCloseTo(expected[key][index], 5));
}

test('Explore owns all authored 3D mappings; reference and spatial selection never navigate Demo', async ({
  page,
}) => {
  await prepare(page);
  await root(page, 'EXPLORE').click();
  const demo = await visual(page, 'viewport');
  // Exercise actual authored geometry, not just registry metadata, for every existing ID.
  const mappings = await page.evaluate(async () => {
    const { conceptRegistry } = await import('/src/concept-registry.ts');
    const s = (window as any).__visuals['explore-viewport'];
    return Object.values(conceptRegistry).map((c: any) => {
      s.setScene(c.anchor.scene);
      return { id: c.id, represented: s.nodes.some((n: any) => n.id === c.id) };
    });
  });
  expect(mappings).toHaveLength(32);
  expect(mappings.filter((m) => !m.represented)).toEqual([]);
  await select(page, 'attention');
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-scene', 'block');
  await page.locator('#explore-reset').click();
  await page.clock.runFor(300);
  // Click the actual model: crowded labels may legitimately be suppressed.
  const point = await page.evaluate(() => {
    const scene = (window as any).__visuals['explore-viewport'];
    const position = scene.nodes.find((n: any) => n.id === 'mlp').group.position.clone();
    position.y += 0.3;
    position.project(scene.camera);
    const rect = scene.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (position.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-position.y * 0.5 + 0.5) * rect.height,
    };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#explore-reference-title')).toHaveText('MLP · feed-forward');
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', 'mlp');
  await expect(page.locator('#explore-workspace .world-callout[data-role="guided"]')).toHaveCount(0);
  await expect(page.locator('.playback')).toBeHidden();
  expect(await visual(page, 'viewport')).toEqual(demo);
  expect(await page.locator('#app').getAttribute('data-guided-session')).toBeNull();
});

test('Explore orbit/pan/zoom, scene bookmarks, concise independent pins and Inspector scroll survive root switching', async ({
  page,
}) => {
  await prepare(page);
  await root(page, 'EXPLORE').click();
  await select(page, 'router');
  await select(page, 'internet');
  const cards = page.locator('#explore-workspace .world-callout');
  await expect(cards).toHaveCount(2);
  await expect(cards.locator('.callout-detail:visible')).toHaveCount(0);
  // Exercise pointer controls on a clear patch below the scene.
  const box = (await page.locator('#explore-viewport').boundingBox())!;
  const before = await visual(page, 'explore-viewport');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height - 55, { steps: 10 });
  await page.mouse.up();
  await page.clock.runFor(1500);
  const orbited = await visual(page, 'explore-viewport');
  expect(orbited.camera.position).not.toEqual(before.camera.position);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 + 95, box.y + box.height - 75, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -100);
  await page.clock.runFor(1800);
  const moved = await visual(page, 'explore-viewport');
  expect(moved.camera.target).not.toEqual(orbited.camera.target);
  expect(moved.camera.zoom).not.toEqual(orbited.camera.zoom);
  const scroll = await page.locator('.explore-reference').evaluate((e) => {
    e.scrollTop = 240;
    return e.scrollTop;
  });
  await root(page, 'DEMO').click();
  await root(page, 'LIVE').click();
  await root(page, 'EXPLORE').click();
  expectCameraClose((await visual(page, 'explore-viewport')).camera, moved.camera);
  expect(await page.locator('.explore-reference').evaluate((e) => e.scrollTop)).toBe(scroll);
  await expect(cards).toHaveCount(2);
  await page.locator('#explore-view').selectOption('model');
  await page.locator('#explore-view').selectOption('world');
  expectCameraClose((await visual(page, 'explore-viewport')).camera, moved.camera);
  await expect(cards).toHaveCount(2);
  // Close via DOM activation even if a remembered anchor has been panned offscreen.
  await cards
    .locator('[aria-label="Close Wi-Fi & router callout"]')
    .evaluate((b: HTMLButtonElement) => b.click());
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('data-subject', 'internet');
  expect((await visual(page, 'explore-viewport')).emphasis.every(([, value]: any) => value === 0)).toBe(true);
  expect((await visual(page, 'explore-viewport')).particleVisible).toBe(false);
  const duplicateIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);
});

for (const mode of ['AUTO', 'MANUAL'])
  test(`${mode} parked Demo keeps its own emphasis, particles and view; Return restores guidance`, async ({
    page,
  }) => {
    await prepare(page);
    await page.locator('#journey-mode').selectOption(mode);
    await page.locator('#start-tour').click();
    await page.locator('#timeline').fill('6');
    await page.clock.runFor(1800);
    if (mode === 'AUTO') await page.locator('#play').click();
    await root(page, 'EXPLORE').click();
    const parked = await visual(page, 'viewport');
    expect(parked.emphasis.some(([, value]: any) => value > 0.9)).toBe(true);
    await select(page, 'router');
    const local = await visual(page, 'explore-viewport');
    expect(local.emphasis.every(([, value]: any) => value === 0)).toBe(true);
    expect(local.flow).toBe(false);
    expect(local.particleVisible).toBe(false);
    await expect(page.locator('#explore-workspace [data-role="guided"]')).toHaveCount(0);
    await page.clock.runFor(1200);
    const hidden = await visual(page, 'viewport');
    expect(hidden.camera).toEqual(parked.camera);
    expect(hidden.phase).toBeGreaterThan(parked.phase);
    expect(hidden.packet).toBe(parked.packet);
    // Modal suspension freezes Demo's owned phase even while its renderer is hidden.
    await page.locator('#appearance-open').click();
    const frozen = (await visual(page, 'viewport')).phase;
    await page.clock.runFor(1200);
    expect((await visual(page, 'viewport')).phase).toBe(frozen);
    await page.keyboard.press('Escape');
    await root(page, 'DEMO').click();
    await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'DETACHED');
    expect((await visual(page, 'viewport')).camera).toEqual(parked.camera);
    await page.clock.runFor(800);
    expect((await visual(page, 'viewport')).phase).toBeGreaterThan(frozen);
    await root(page, 'EXPLORE').click();
    await page.locator('#global-session-return').click();
    await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
    await expect(page.locator('#timeline')).toHaveValue('6');
    await expect(page.locator('#journey-mode')).toHaveValue(mode);
    await expect(page.locator('.playback')).toHaveAttribute('data-advancing', 'false');
    await expect(page.locator('#demo-host .world-callout[data-role="guided"]')).toHaveAttribute(
      'data-subject',
      'gpu',
    );
  });

test('retained Completed hierarchy and Explore visual memory restore independently in light and dark', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('#journey-mode').selectOption('MANUAL');
  await page.locator('#start-tour').click();
  await page.locator('#timeline').fill('17');
  await page.locator('#complete-tour').click();
  await page.clock.runFor(1800);
  await root(page, 'EXPLORE').click();
  const completed = await visual(page, 'viewport');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme').click();
    await select(page, 'cache');
    await page.screenshot({ path: `artifacts/v4/part4-explore-${theme}.png` });
    await root(page, 'DEMO').click();
    await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
    await expect(page.locator('#global-session')).toBeHidden();
    const restored = await visual(page, 'viewport');
    expect(restored.camera).toEqual(completed.camera);
    expect(restored.emphasis).toEqual(completed.emphasis);
    expect(restored.flow).toBe(false);
    await page.screenshot({ path: `artifacts/v4/part4-completed-demo-${theme}.png` });
    await root(page, 'EXPLORE').click();
  }
});

test('hidden renderers do not draw; reduced motion stays particle-free and view disposal is local', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await page.locator('#start-tour').click();
  await root(page, 'EXPLORE').click();
  await page.evaluate(() => {
    for (const s of Object.values((window as any).__visuals) as any[]) {
      s.draws = 0;
      const render = s.renderer.render.bind(s.renderer);
      s.renderer.render = (...args: any[]) => {
        s.draws++;
        render(...args);
      };
      s.dirty = true;
    }
  });
  await page.clock.runFor(1000);
  expect((await visual(page, 'viewport')).particleVisible).toBe(false);
  expect((await visual(page, 'explore-viewport')).particleVisible).toBe(false);
  expect(await page.evaluate(() => (window as any).__visuals.viewport.draws)).toBe(0);
  expect(await page.evaluate(() => (window as any).__visuals['explore-viewport'].draws)).toBeGreaterThan(0);
  await page.locator('#explore-viewport canvas').dispatchEvent('webglcontextlost');
  await expect(page.locator('#explore-viewport canvas')).toHaveCount(0);
  await expect(page.locator('#explore-workspace .callout-layer')).toHaveCount(0);
  await expect(page.locator('#explore-view-note')).toContainText('3D is unavailable');
  await select(page, 'router');
  await expect(page.locator('#explore-reference-title')).toHaveText('Wi-Fi & router');
  await page.locator('#global-session-return').click();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('.playback')).toHaveAttribute('data-guided-focus', 'TRACKING');
});
