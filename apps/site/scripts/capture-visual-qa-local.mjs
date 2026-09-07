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
// Landing is mounted once the fixed header and the first scroll-revealed section exist.
const mountedWait = 'header, #flow, #install';

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
  if (opts.scrollTo) {
    await page.locator(opts.scrollTo).scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(opts.delay ?? 800);
  if (opts.probe) {
    const probe = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.title,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hasHeader: Boolean(document.querySelector('header')),
      hasNoise: Boolean(document.querySelector('.noise')),
      hasTui: Boolean(document.querySelector('.tui')),
      hiddenReveals: Array.from(document.querySelectorAll('.rv:not(.on)')).filter(
        (el) => el.getBoundingClientRect().top < window.innerHeight,
      ).length,
    }));
    console.log(name, 'probe', JSON.stringify(probe));
  }
  await page.screenshot({ path: join(out, name), fullPage: false });
  await page.close();
  console.log('wrote', name);
}

for (const s of [
  { name: 'mobile-390.png', viewport: { width: 390, height: 844 }, wait: mountedWait },
  { name: 'tablet-768.png', viewport: { width: 768, height: 1024 }, wait: mountedWait },
  { name: 'desktop-1440.png', viewport: { width: 1440, height: 900 }, wait: mountedWait, probe: true },
  { name: 'wide-2560.png', viewport: { width: 2560, height: 1440 }, wait: mountedWait },
]) {
  await shot(s.name, s);
}

await shot('first-paint-1440.png', { wait: mountedWait, delay: 0, probe: true });
await shot('en-desktop-1440.png', { url: `${base}en/`, wait: mountedWait });
await shot('demo-console-1440.png', { wait: mountedWait, scrollTo: '#demo', delay: 1400 });
await shot('install-section-1440.png', { wait: mountedWait, scrollTo: '#install', delay: 1200 });
await shot('docs-getting-started-1440.png', {
  url: `${base}docs/getting-started.html`,
  wait: 'main, article, .mesh-bg',
});

await browser.close();
console.log('done ->', out);
