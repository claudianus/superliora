/**
 * Local visual QA capture using playwright-core + Cloak/Chrome binary.
 * Does not add Playwright as a package dependency.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightCorePath = require.resolve('playwright-core/package.json', {
  paths: [join(dirname(fileURLToPath(import.meta.url)), '../../../packages/gui-use')],
});
const { chromium } = require(join(dirname(playwrightCorePath), 'index.js'));

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.OUT_DIR ?? join(here, '../.visual-qa/after');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4176/superliora/';
const chrome =
  process.env.CHROME_PATH ??
  'C:\\Users\\Administrator\\.cloakbrowser\\chromium-146.0.7680.177.5\\chrome.exe';
const heroWait = '.hero-band--cinematic, .hero-layout, .product-band, .product-frame__body, .tui-chrome';

mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--disable-gpu', '--no-sandbox'],
});

async function shot(name, opts = {}) {
  const page = await browser.newPage({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  if (opts.init) await page.addInitScript(opts.init);
  const res = await page.goto(opts.url ?? base, { waitUntil: 'networkidle', timeout: 30000 });
  if (res && res.status() >= 400) {
    throw new Error(`${name}: HTTP ${String(res.status())}`);
  }
  if (opts.wait) await page.waitForSelector(opts.wait, { timeout: 15000 });
  if (opts.scrollY) await page.evaluate((y) => window.scrollBy(0, y), opts.scrollY);
  if (opts.click) {
    await page.locator(opts.click).first().click({ timeout: 10000 });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(opts.delay ?? 800);
  if (opts.probe) {
    const probe = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hasNoir: Boolean(document.querySelector('.noir-field:not([hidden])')),
      hasLiving: Boolean(document.querySelector('.living-field:not([hidden])')),
      productInHero: Boolean(
        document.querySelector('.hero-band--cinematic .product-frame, .hero-band--cinematic .tui-chrome'),
      ),
    }));
    console.log(name, 'probe', JSON.stringify(probe));
  }
  await page.screenshot({ path: join(out, name), fullPage: false });
  await page.close();
  console.log('wrote', name);
}

for (const s of [
  { name: 'mobile-390.png', viewport: { width: 390, height: 844 }, wait: heroWait },
  { name: 'tablet-768.png', viewport: { width: 768, height: 1024 }, wait: heroWait },
  { name: 'desktop-1440.png', viewport: { width: 1440, height: 900 }, wait: heroWait, probe: true },
  { name: 'wide-2560.png', viewport: { width: 2560, height: 1440 }, wait: heroWait },
]) {
  await shot(s.name, s);
}

await shot('mobile-390-menu.png', {
  viewport: { width: 390, height: 844 },
  wait: heroWait,
  click: 'button.nav-burger, [data-nav-toggle]',
});
await shot('dark-first-paint-1440.png', { wait: heroWait, probe: true });
await shot('light-home-1440.png', {
  wait: heroWait,
  probe: true,
  init: () => {
    try {
      localStorage.setItem('superliora-theme', 'light');
    } catch {
      // ignore
    }
  },
});
await shot('verify-surface.png', { wait: heroWait, scrollY: 420 });
await shot('en-desktop-1440.png', { url: `${base}en/`, wait: heroWait });
await shot('docs-getting-started-1440.png', {
  url: `${base}docs/getting-started.html`,
  wait: 'main, article, .mesh-bg',
});

{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#features').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'features-bento-1440.png'), fullPage: false });
  await page.close();
  console.log('wrote features-bento-1440.png');
}

await browser.close();
console.log('done ->', out);
