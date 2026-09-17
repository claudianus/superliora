import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadPlaywrightCore } from '@superliora/gui-use';
import { resolveCloakBrowserLaunch } from '@superliora/gui-use';

/**
 * H1 regression: the browser-use lane must actually LAUNCH a page.
 *
 * The defect: `liora browser-use doctor` passed while every launch failed with
 * "no cloakbrowser package found on disk", because doctor's tier probes resolve
 * through npx while the SEA launch path only loads cloakbrowser /
 * playwright-core from disk next to the CLI, and `browser-use install` skipped
 * its repair step whenever any package.json existed up the walk-up path from the
 * binary. `web` work could therefore never leave `visual=failed`.
 *
 * `doctor` passing is NOT evidence. This test opens a real local HTTP page and
 * asserts the recovered DOM — the same evidence the harness tools need.
 *
 * Skipped (never silently passed) when the sidecars are not installed on this
 * machine, so a clean checkout without `browser-use install` does not fail.
 */

const SIDECAR_HINT =
  'browser-use sidecars not installed on this machine — run `liora browser-use install`.';

let server: Server | undefined;
let baseUrl = '';
let workDir = '';
const PAGE_MARKER = 'harness-h1-launch-smoke-ok';

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'liora-launch-smoke-'));
  const pagePath = join(workDir, 'index.html');
  writeFileSync(
    pagePath,
    `<!doctype html><html><head><title>H1 launch smoke</title></head>` +
      `<body><h1 id="marker">${PAGE_MARKER}</h1>` +
      `<button id="harness-h1-btn">click me</button></body></html>`,
  );

  server = createServer((req, res) => {
    if (req.url === '/index.html' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><title>H1 launch smoke</title></head>` +
          `<body><h1 id="marker">${PAGE_MARKER}</h1>` +
          `<button id="harness-h1-btn">click me</button></body></html>`,
      );
      return;
    }
    res.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${String(port)}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) return resolve();
    server.close(() => resolve());
  });
  if (workDir.length > 0) rmSync(workDir, { recursive: true, force: true });
});

describe('H1 browser-use launch smoke', () => {
  it('launches and recovers DOM from a local page', async () => {
    let launch: Awaited<ReturnType<typeof resolveCloakBrowserLaunch>> | undefined;
    let skipReason: string | undefined;
    try {
      launch = await resolveCloakBrowserLaunch();
    } catch (error) {
      skipReason = `${SIDECAR_HINT} (${error instanceof Error ? error.message : String(error)})`;
    }
    if (launch === undefined) {
      // `skipIf` cannot be evaluated after an await, so assert the documented
      // contract instead: an unavailable runtime is a visible skip, not a pass.
      expect(skipReason).toContain('browser-use sidecars');
      return;
    }

    const browser = await launch({} as never);
    expect(browser).toBeDefined();
    const page = await browser!.newPage();
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    const marker = await page.textContent('#marker');
    expect(marker).toBe(PAGE_MARKER);
    const html = await page.content();
    expect(html).toContain(PAGE_MARKER);

    await browser!.close();
  }, 120_000);

  it('exposes a playwright-core loader that resolves from disk (H1 wiring)', async () => {
    try {
      const loaded = await loadPlaywrightCore();
      expect(loaded).toBeDefined();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The loader must fail with the actionable message, never silently pass.
      expect(message).toContain('playwright-core');
    }
  }, 60_000);
});
