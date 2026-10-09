import { test, expect, type Page } from '@playwright/test';

const root = (page: Page, id: string) => page.locator(`.workspace-nav [data-workspace="${id}"]`);
const category = (page: Page, id: string) =>
  page.locator(`.explore-contents [data-explore-category="${id}"]`);
const concept = (page: Page, id: string) => page.locator(`.explore-contents [data-explore-concept="${id}"]`);
async function prepare(page: Page) {
  const response = page.waitForResponse((r) => /\/src\/scene\.ts(?:\?|$)/.test(r.url()));
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  const path = (await response).url();
  await page.clock.install();
  await page.evaluate(async (path) => {
    const { AtlasScene } = await import(/* @vite-ignore */ path);
    const original = AtlasScene.prototype.setPresentationSuspended;
    AtlasScene.prototype.setPresentationSuspended = function (value: boolean) {
      (window as any).__exploreDemoScene = this;
      original.call(this, value);
    };
  }, path);
  await page.locator('#journey-mode').selectOption('MANUAL');
}
async function demoState(page: Page) {
  return page.evaluate(() => {
    const scene = (window as any).__exploreDemoScene;
    return {
      pose: [...scene.camera.position.toArray(), ...scene.controls.target.toArray(), scene.camera.zoom].map(
        (n: number) => n.toFixed(8),
      ),
      scene: scene.sceneId,
      selection: scene.selected,
      stage: (document.getElementById('timeline') as HTMLInputElement).value,
      journey: { ...document.querySelector<HTMLElement>('.playback')!.dataset },
      intent: document.getElementById('play')!.getAttribute('aria-label'),
      requestMode: (document.getElementById('mode') as HTMLSelectElement).value,
      renderer: scene.renderer.domElement === document.querySelector('#viewport canvas'),
      pins: [...document.querySelectorAll('.world-callout')].map((card) => [
        card.getAttribute('data-subject'),
        card.getAttribute('data-role'),
      ]),
    };
  });
}

test('hierarchy, reference, related concepts and sources stay within Explore and retain Demo', async ({
  page,
}) => {
  await prepare(page);
  await page.locator('.object-label[data-concept="router"]').focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(1500);
  const before = await demoState(page);
  await root(page, 'EXPLORE').click();
  await expect(page.locator('#explore-reference-title')).toHaveText('Explore');
  await expect(page.getByRole('tab', { name: 'Journey', exact: true })).toHaveCount(0);
  await expect(page.locator('#explore-workspace canvas')).toHaveCount(0);
  await expect(page.locator('.playback')).toBeHidden();
  await expect(page.locator('.explore-category-list > button')).toHaveCount(9);
  await category(page, 'model').click();
  await category(page, 'blocks').click();
  await category(page, 'attention').click();
  await concept(page, 'attention').click();
  await expect(page.locator('#explore-reference-title')).toHaveText('Causal self-attention');
  await expect(page.locator('.explore-breadcrumbs')).toContainText('Model inference');
  await expect(page.locator('.explore-reference')).toContainText('Queries and keys');
  await expect(page.locator('.explore-reference .io')).toContainText('INPUT');
  await expect(page.locator('.explore-reference .source-list a').first()).toHaveAttribute('href', /^https:/);
  const related = page.locator('.explore-reference [data-explore-concept]').first();
  const destination = await related.getAttribute('data-explore-concept');
  await related.click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', destination!);
  await expect(page.locator('#explore-reference-title')).toBeFocused();
  await root(page, 'LIVE').click();
  await expect(page.locator('#workspace-title')).toHaveText('Live Lab');
  await expect(page.locator('#workspace-description')).toContainText('not implemented');
  await root(page, 'EXPLORE').click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-concept', destination!);
  await root(page, 'DEMO').click();
  expect(await demoState(page)).toEqual(before);
  await page.locator('#start-tour').click();
  await page.locator('#next').click();
  await expect(page.locator('#timeline')).toHaveValue('1');
  await expect(page.locator('#journey-mode')).toHaveValue('MANUAL');
});

test('empty future categories are truthful and breadcrumbs navigate back', async ({ page }) => {
  await prepare(page);
  await root(page, 'EXPLORE').click();
  await category(page, 'retrieval').click();
  await expect(page.locator('.explore-category-list > button')).toHaveCount(4);
  await expect(page.locator('.explore-category-list')).toContainText('Not yet populated');
  await category(page, 'rag').click();
  await expect(page.locator('.explore-reference')).toContainText('has not been added');
  await expect(page.locator('#explore-workspace [data-explore-concept]')).toHaveCount(0);
  await page.locator('.explore-breadcrumbs [data-explore-category="all"]').click();
  await category(page, 'web').click();
  await expect(page.locator('#explore-workspace')).toHaveAttribute('data-category', 'web');
  await expect(page.locator('#explore-workspace [data-explore-concept]')).toHaveCount(0);
});

for (const mode of ['AUTO', 'MANUAL'])
  test(`${mode} completion survives Explore search; guard still blocks incomplete journeys`, async ({
    page,
  }) => {
    await prepare(page);
    await page.locator('#journey-mode').selectOption(mode);
    await page.locator('#start-tour').click();
    await root(page, 'EXPLORE').click();
    await expect(root(page, 'DEMO')).toHaveAttribute('aria-current', 'page');
    await page.locator('#timeline').fill('17');
    if (mode === 'AUTO') await page.clock.runFor(6200);
    else {
      await page.locator('#complete-tour').click();
      await page.clock.runFor(1800);
    }
    const before = await demoState(page);
    await root(page, 'EXPLORE').click();
    await page.keyboard.press('/');
    await page.locator('#search-input').fill('KV cache');
    await page.keyboard.press('Enter');
    await expect(page.locator('#search-dialog')).not.toBeVisible();
    await expect(page.locator('#explore-reference-title')).toHaveText('KV cache');
    await expect(page.locator('.explore-breadcrumbs')).toContainText('Transformer blocks');
    await expect(page.locator('#explore-reference-title')).toBeFocused();
    await page.locator('#search-open').click();
    await page.locator('#search-input').fill('no matching concept');
    await expect(page.locator('#search-results')).toContainText('No concepts found');
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await expect(page.locator('#search-dialog')).not.toBeVisible();
    await root(page, 'DEMO').click();
    expect(await demoState(page)).toEqual(before);
    await expect(page.locator('#guidance-status')).toHaveText('Journey complete');
    await expect(page.locator('#stop-tour')).toBeHidden();
  });

for (const width of [1440, 820, 390])
  test(`Explore reference is usable at ${width}px in light and dark`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/');
    await expect(page.locator('#viewport canvas')).toBeVisible();
    await root(page, 'EXPLORE').click();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('#theme').click();
      await page.locator('.explore-breadcrumbs [data-explore-category="all"]').click();
      await page.screenshot({ path: `artifacts/v4/part2-${width}-${theme}-contents.png` });
      await category(page, 'network').click();
      await concept(page, 'router').click();
      await expect(page.locator('#explore-reference-title')).toBeInViewport();
      await expect(page.locator('#explore-reference-title')).toBeFocused();
      const reference = await page.locator('.explore-reference').boundingBox();
      expect(reference!.x).toBeGreaterThanOrEqual(0);
      expect(reference!.x + reference!.width).toBeLessThanOrEqual(width);
      const overflowing = await page
        .locator('#explore-workspace')
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(overflowing).toBe(false);
      await page.screenshot({ path: `artifacts/v4/part2-${width}-${theme}-reference.png` });
    }
  });
