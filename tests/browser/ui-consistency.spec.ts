import { test, expect, type Page } from '@playwright/test';

const root = (page: Page, id: string) => page.locator(`.workspace-nav [data-workspace="${id}"]`);
async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function geometry(page: Page, selector: string) {
  return page.locator(selector).evaluate((e) => {
    const r = e.getBoundingClientRect();
    const c = getComputedStyle(e);
    return { x: r.x, y: r.y, width: r.width, radius: c.borderRadius };
  });
}
for (const width of [1920, 1440, 1100]) {
  test(`desktop shell shares Demo panel edges and stable root navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 });
    await open(page);
    const left = await geometry(page, '.journey-panel');
    const right = await geometry(page, '.inspector-panel');
    const tabs = await geometry(page, '.workspace-nav');
    const heading = await geometry(page, '#demo-host .scene-intro');
    if (width === 1920) await page.screenshot({ path: 'artifacts/v4/part75-demo-light.png' });
    await root(page, 'EXPLORE').click();
    await expect(page.locator('#explore-reference')).toBeHidden();
    expect(await geometry(page, '#explore-contents')).toEqual(left);
    expect(await geometry(page, '.workspace-nav')).toEqual(tabs);
    expect((await geometry(page, '.explore-intro')).y).toBe(heading.y);
    await page.locator('[data-explore-category="serving"]').first().click();
    await expect(page.locator('#explore-reference')).toBeHidden();
    await page.locator('[data-explore-concept="rack"]').first().click();
    expect(await geometry(page, '#explore-reference')).toEqual(right);
    await expect(page.locator('#explore-reference-title')).toHaveText('Server rack');
    await page.locator('#explore-contents-close').click();
    await expect(page.locator('#explore-contents-toggle')).toBeFocused();
    await expect(page.locator('#explore-contents')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.locator('#explore-contents')).toBeVisible();
    const canvas = (await page.locator('#explore-viewport').boundingBox())!;
    expect(canvas.width).toBe(width);
    expect(canvas.height).toBe(1080);
    if (width === 1920) {
      await page.screenshot({ path: 'artifacts/v4/part75-explore-light.png' });
      await page.locator('#theme').click();
      await page.screenshot({ path: 'artifacts/v4/part75-explore-dark.png' });
      await page.locator('#theme').click();
    }
    await root(page, 'LIVE').click();
    expect(await geometry(page, '#live-runtime')).toEqual(left);
    expect(await geometry(page, '#live-inspector')).toEqual(right);
    expect(await geometry(page, '.workspace-nav')).toEqual(tabs);
    expect((await geometry(page, '#live-workspace .scene-intro')).y).toBe(heading.y);
    if (width === 1920) {
      await page.screenshot({ path: 'artifacts/v4/part75-live-light.png' });
      await page.locator('#theme').click();
      await page.screenshot({ path: 'artifacts/v4/part75-live-dark.png' });
    }
    await root(page, 'DEMO').click();
    expect(await geometry(page, '.journey-panel')).toEqual(left);
    expect(await geometry(page, '.inspector-panel')).toEqual(right);
  });
}

for (const width of [1440, 900, 390]) {
  test(`declaration form stacks accessible fields and reachable actions in both themes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await open(page);
    await root(page, 'LIVE').click();
    if (width < 981) await page.locator('[data-live-panel="runtime"]').click();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('#theme').click();
      await page.locator('#live-capability-settings').click();
      const declarations = page.locator('.media-configuration');
      await expect(declarations).toHaveAttribute('open', '');
      const summary = declarations.locator('summary');
      const headings = await page
        .locator('#navigation-title, .connection-title, .media-configuration > summary')
        .evaluateAll((elements) =>
          elements.map((e) => {
            const c = getComputedStyle(e);
            return {
              size: c.fontSize,
              weight: c.fontWeight,
              line: c.lineHeight,
              font: c.fontFamily,
              color: c.color,
            };
          }),
        );
      expect(headings[0]).toEqual(headings[1]);
      expect(headings[2]).toEqual(headings[0]);

      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(declarations).not.toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
      const fields = await declarations.evaluate((section) => {
        const rect = section.getBoundingClientRect();
        return [...section.querySelectorAll('label')].map((label) => {
          const input = label.control!;
          const a = label.getBoundingClientRect(),
            b = input.getBoundingClientRect();
          return {
            id: input.id,
            labelBottom: a.bottom,
            inputTop: b.top,
            inputBottom: b.bottom,
            labelTop: a.top,
            left: b.left - rect.left,
            right: b.right - rect.right,
            width: b.width,
          };
        });
      });
      expect(fields).toHaveLength(6);
      fields.forEach((field, i) => {
        expect(field.inputTop - field.labelBottom).toBeGreaterThanOrEqual(6);
        expect(field.left).toBeGreaterThanOrEqual(0);
        expect(field.right).toBeLessThanOrEqual(1);
        expect(field.width).toBe(fields[0].width);
        if (i) expect(field.labelTop - fields[i - 1].inputBottom).toBeGreaterThan(12);
      });
      await page.locator('#provider-generation-model').focus();
      expect(
        await page.locator('#provider-generation-model').evaluate((e) => getComputedStyle(e).outlineStyle),
      ).not.toBe('none');
      await page.keyboard.press('Tab');
      await expect(page.locator('#provider-media-imageText')).toBeFocused();
      await page.screenshot({ path: `artifacts/v4/part75-settings-${theme}-${width}.png` });
      const save = page.getByRole('button', { name: 'Save connection' });
      await save.scrollIntoViewIfNeeded();
      const dialog = await page.locator('#settings-dialog').boundingBox();
      const button = await save.boundingBox();
      expect(button!.y + button!.height).toBeLessThanOrEqual(dialog!.y + dialog!.height);
      expect(await page.locator('#settings-dialog').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
        true,
      );
      await page.locator('#settings-dialog .dialog-actions [data-close]').click();
    }
    // Existing narrow-screen sheets and Explore reference remain usable.
    await root(page, 'EXPLORE').click();
    if (width <= 700) await page.locator('#explore-contents-toggle').click();
    await page.locator('[data-explore-category="serving"]').first().click();
    await page.locator('[data-explore-concept="rack"]').first().click();
    await expect(page.locator('#explore-reference-title')).toBeVisible();
    await page.screenshot({ path: `artifacts/v4/part75-explore-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('capability guidance explains missing configuration and preserves Unknown/Unsupported/Supported gates', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'atlas-provider',
      JSON.stringify({ url: '', model: '', stream: false, logprobs: false }),
    ),
  );
  await open(page);
  await root(page, 'LIVE').click();
  const text = page.locator('[data-capability="TEXT"]');
  const understanding = page.locator('[data-capability="IMAGE_UNDERSTANDING"]');
  const generation = page.locator('[data-capability="IMAGE_GENERATION"]');
  const imageOption = page.locator('#live-request-type option[value="IMAGE_UNDERSTANDING"]');
  const generationOption = page.locator('#live-request-type option[value="IMAGE_GENERATION"]');
  await expect(text).toContainText('Connection configuration required');
  await expect(text).toContainText('Model identifier required');
  await expect(understanding).toContainText('Unknown / not advertised');
  await expect(generation).toContainText('Image-generation model required');
  await expect(imageOption).toBeDisabled();
  await expect(generationOption).toBeDisabled();
  await expect(page.locator('#live-request-type')).toHaveAttribute('aria-describedby', 'live-media-support');
  await page.locator('#live-capability-settings').click();
  await expect(page.locator('#provider-url')).toBeFocused();
  await page.locator('#provider-url').fill('https://example.test/v1');
  await page.locator('#provider-model').fill('example-model');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(text).toHaveText('Ready');
  await expect(understanding).toContainText('Unknown');
  await expect(imageOption).toBeDisabled();
  await page.locator('#live-capability-settings').click();
  await expect(page.locator('.media-configuration summary')).toBeFocused();
  await page.locator('#provider-generation-model').fill('image-model');
  for (const id of ['imageText', 'imageGeneration', 'generatedMedia'])
    await page.locator(`#provider-media-${id}`).selectOption('UNSUPPORTED');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(understanding).toContainText('explicitly Unsupported');
  await expect(generation).toContainText('Image-generation endpoint support is explicitly Unsupported');
  await expect(generation).toContainText('Generated-media return support is explicitly Unsupported');
  await expect(imageOption).toBeDisabled();
  await expect(generationOption).toBeDisabled();
  await page.locator('#live-capability-settings').click();
  await page.locator('#provider-media-imageText').selectOption('SUPPORTED');
  await page.locator('#provider-media-imageGeneration').selectOption('SUPPORTED');
  await page.locator('#provider-media-generatedMedia').selectOption('UNKNOWN');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(understanding).toHaveText('Ready');
  await expect(imageOption).toBeEnabled();
  await expect(generation).toContainText('Generated-media return support is Unknown');
  await expect(generationOption).toBeDisabled();
  await page.locator('#live-capability-settings').click();
  await page.locator('#provider-media-generatedMedia').selectOption('SUPPORTED');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(generation).toHaveText('Ready');
  await expect(generationOption).toBeEnabled();
  await page.locator('#live-capability-settings').click();
  await page.locator('#provider-model').fill('other-model');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(imageOption).toBeDisabled();
  await expect(generationOption).toBeDisabled();
  await expect(text).toHaveText('Ready');
});

for (const width of [1440, 900, 390]) {
  test(`compact capability rows and Inspector section hierarchy remain readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await open(page);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.locator('#theme').click();
      await root(page, 'LIVE').click();
      if (!(await page.locator('#live-runtime').isVisible()))
        await page.locator('[data-live-panel="runtime"]').click();
      const status = page.locator('#live-capability-status');
      await expect(page.getByRole('heading', { name: 'Request capabilities', level: 2 })).toBeVisible();
      await expect(status.locator('dt')).toHaveText(['Text', 'Image understanding', 'Image generation']);
      await expect(status.locator('strong')).toHaveText([
        'Not configured',
        'Not configured',
        'Not configured',
      ]);
      await expect(page.locator('#live-capability-guide')).not.toHaveAttribute('open', '');
      await expect(page.locator('#live-request-type')).toHaveJSProperty('tagName', 'SELECT');
      await expect(page.locator('#live-request-type option[value="IMAGE_UNDERSTANDING"]')).toBeDisabled();
      await expect(page.locator('#live-request-type option[value="IMAGE_GENERATION"]')).toBeDisabled();
      expect(await status.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      await page.locator('#live-capability-settings').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `artifacts/v4/part751-live-${theme}-${width}.png` });
      await page.locator('#live-capability-settings').click();
      await expect(page.locator('#settings-dialog')).toBeVisible();
      await expect(page.locator('.media-configuration')).toHaveAttribute('open', '');
      await page.locator('#settings-dialog .dialog-actions [data-close]').click();
      await root(page, 'EXPLORE').click();
      for (const id of ['internet', 'decode']) {
        await page.locator('#search-open').click();
        await page.locator('#search-input').fill(id);
        await page.locator(`[data-search-concept="${id}"]`).click();
        const usages = page.locator('.concept-usages');
        const rows = usages.locator('details');
        for (const row of await rows.all()) {
          const count = await row.locator('[data-demo-usage]').count();
          await expect(row.locator('summary')).toContainText(
            `(${count} ${count === 1 ? 'location' : 'locations'})`,
          );
        }
        const first = rows.first();
        await first.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(first).toHaveAttribute('open', '');
        await expect(first.locator('[data-demo-usage]').first()).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(first).not.toHaveAttribute('open', '');
        const usageHeading = usages.getByRole('heading', { name: 'Used in Demo' });
        const sourcesHeading = page.locator('.concept-sources h2');
        const style = (e: Element) => {
          const c = getComputedStyle(e);
          return {
            size: c.fontSize,
            weight: c.fontWeight,
            spacing: c.letterSpacing,
            transform: c.textTransform,
          };
        };
        expect(await usageHeading.evaluate(style)).toEqual(await sourcesHeading.evaluate(style));
        await expect(page.locator('.concept-sources a').first()).toHaveAttribute('href', /^https?:/);
        if (id === 'internet') {
          await usages.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `artifacts/v4/part751-explore-${theme}-${width}.png` });
        }
        expect(
          await page.locator('#explore-reference').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        ).toBe(true);
      }
    }
  });
}
