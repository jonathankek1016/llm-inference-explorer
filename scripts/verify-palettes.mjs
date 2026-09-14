import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const folder = 'artifacts/palettes';
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#viewport canvas').waitFor();
  for (const mode of ['light', 'dark']) {
    if (mode === 'dark') await page.locator('#theme').click();
    for (const name of [
      'Original Sage',
      'Powder Blue',
      'Soft Lavender',
      'Dusty Rose',
      'Warm Apricot',
      'Monochrome',
    ]) {
      await page.getByRole('button', { name: 'Colour palette', exact: true }).click();
      await page.getByRole('radio', { name, exact: true }).check();
      await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
      const geometry = await page.evaluate(() => ({
        panelTop: document.querySelector('#journey-panel').getBoundingClientRect().top,
        introPosition: getComputedStyle(document.querySelector('.scene-intro')).position,
        introBackground: getComputedStyle(document.querySelector('.scene-intro')).backgroundColor,
        font: getComputedStyle(document.documentElement).fontSize,
      }));
      assert(geometry.panelTop < 160);
      assert.equal(geometry.introPosition, 'absolute');
      assert.equal(geometry.introBackground, 'rgba(0, 0, 0, 0)');
      assert.equal(geometry.font, '17.6px');
      await page.screenshot({ path: `${folder}/${mode}-${name.replaceAll(' ', '-').toLowerCase()}.png` });
    }
    await page.getByRole('button', { name: 'Colour palette', exact: true }).click();
    await page.getByRole('radio', { name: 'Custom accent', exact: true }).check();
    await page.getByRole('textbox', { name: 'Accent hex colour', exact: true }).fill('#db7762');
    await page.screenshot({ path: `${folder}/${mode}-appearance.png` });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.screenshot({ path: `${folder}/${mode}-appearance-mobile.png` });
    await page.getByRole('button', { name: 'Close appearance', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 960 });
  }
} finally {
  await browser.close();
}
console.log(
  'Six palettes in both modes; custom appearance dialog on desktop and mobile checked at 100% zoom.',
);
