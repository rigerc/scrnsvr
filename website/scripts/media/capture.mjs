import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { baseUrl, assertTargetIsThisSite } from './target.mjs';

await assertTargetIsThisSite();
const outDir = resolve('media-output/screenshots');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const views = [
  { name: 'home-desktop', route: '/', width: 1440, height: 900, mobile: false },
  { name: 'home-mobile', route: '/', width: 390, height: 844, mobile: true },
  { name: 'gallery-desktop', route: '/gallery/', width: 1440, height: 900, mobile: false },
  { name: 'gallery-mobile', route: '/gallery/', width: 390, height: 844, mobile: true },
  { name: 'install-desktop', route: '/docs/install/', width: 1440, height: 900, mobile: false },
  { name: 'install-mobile', route: '/docs/install/', width: 390, height: 844, mobile: true },
];
try {
  for (const view of views) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: 1,
      isMobile: view.mobile,
      hasTouch: view.mobile,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      locale: 'en-US',
    });
    const page = await context.newPage();
    const url = `${baseUrl}${view.route}`;
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    if (!response || !response.ok()) throw new Error(`Capture failed: ${url} returned ${response?.status()}`);
    await page.evaluate(() => document.fonts.ready);
    // A full-page screenshot also shows thumbnails that start below the fold.
    await page.evaluate(async () => {
      const images = [...document.images];
      for (const image of images) image.loading = 'eager';
      await Promise.all(images.map((image) => image.decode()));
    });
    await page.screenshot({ path: resolve(outDir, `${view.name}.png`), fullPage: true, animations: 'disabled' });
    console.log(`Captured ${view.name}.png`);
    await context.close();
  }
} finally {
  await browser.close();
}
