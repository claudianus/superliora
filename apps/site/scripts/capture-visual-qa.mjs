/**
 * Capture VISUAL-QA viewport PNGs against a running preview.
 *
 *   pnpm -C apps/site run build
 *   pnpm -C apps/site exec vite preview --host 127.0.0.1 --port 4176
 *   BASE_URL=http://127.0.0.1:4176/superliora/ node apps/site/scripts/capture-visual-qa.mjs
 *
 * Requires `playwright` resolvable (dev install or NODE_PATH).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.OUT_DIR ?? join(here, '../.visual-qa/after');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4176/superliora/';
mkdirSync(out, { recursive: true });

const shots = [
  { name: 'mobile-390.png', w: 390, h: 844 },
  { name: 'tablet-768.png', w: 768, h: 1024 },
  { name: 'desktop-1440.png', w: 1440, h: 900 },
  { name: 'wide-2560.png', w: 2560, h: 1440 },
];

const browser = await chromium.launch();

for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  const res = await page.goto(base, { waitUntil: 'networkidle' });
  if (res && res.status() >= 400) {
    throw new Error(`${s.name}: HTTP ${String(res.status())} for ${base}`);
  }
  await page.waitForSelector('.hero-layout, .product-frame__body, .tui-chrome', { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(out, s.name), fullPage: false });
  await page.close();
  console.log('wrote', s.name);
}

{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('button.nav-burger, [data-nav-toggle]').first().click({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'mobile-390-menu.png'), fullPage: false });
  await page.close();
  console.log('wrote mobile-390-menu.png');
}

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollBy(0, 420));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, 'verify-surface.png'), fullPage: false });
  await page.close();
  console.log('wrote verify-surface.png');
}

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${base}en/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero-layout, .product-frame__body, .tui-chrome', { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, 'en-desktop-1440.png'), fullPage: false });
  await page.close();
  console.log('wrote en-desktop-1440.png');
}

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.bento', { timeout: 10000 });
  await page.locator('#features').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'features-bento-1440.png'), fullPage: false });
  await page.close();
  console.log('wrote features-bento-1440.png');
}

await browser.close();
console.log('done ->', out);
