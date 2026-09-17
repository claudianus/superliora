/**
 * Sidecar readiness probe for the browser-use lane (harness defect H1).
 *
 * `liora browser-use doctor` passes because its tier probes fall back to
 * `npx cloakbrowser`, but the SEA launch path only loads cloakbrowser /
 * playwright-core from disk (`resolveCloakbrowserImportUrls`,
 * `resolvePlaywrightCoreImportUrls`). `install` used to skip the repair step
 * whenever *any* package.json was found while walking up from the binary — a
 * stray `$HOME/package.json` or `~/.local/package.json` was enough — so the
 * two paths disagreed and every launch failed.
 *
 * This probe asks the same question the launch path asks: can we load the
 * packages from disk next to the CLI?
 */

import { existsSync } from 'node:fs';

import {
  resolveCloakbrowserImportUrls,
  resolvePlaywrightCoreImportUrls,
} from '@superliora/gui-use';

export interface BrowserUseSidecarStatus {
  /** True when both packages resolve to a real file on disk. */
  readonly ready: boolean;
  readonly cloakbrowserUrl?: string | undefined;
  readonly playwrightCoreUrl?: string | undefined;
}

export interface SidecarStatusOptions {
  readonly execPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly packageRoot?: string | undefined;
  /** Test seam: use exactly these candidate URLs instead of disk discovery. */
  readonly cloakbrowserUrls?: readonly string[] | undefined;
  /** Test seam: use exactly these candidate URLs instead of disk discovery. */
  readonly playwrightCoreUrls?: readonly string[] | undefined;
}

/** Non-throwing readiness probe mirroring the SEA launch resolution paths. */
export function probeBrowserUseSidecars(
  options: SidecarStatusOptions = {},
): BrowserUseSidecarStatus {
  const cloakbrowserUrl = firstExisting(
    options.cloakbrowserUrls ??
      resolveCloakbrowserImportUrls({
        execPath: options.execPath,
        cwd: options.cwd,
        packageRoot: options.packageRoot,
      }),
  );
  const playwrightCoreUrl = firstExisting(
    options.playwrightCoreUrls ??
      resolvePlaywrightCoreImportUrls({
        execPath: options.execPath,
        cwd: options.cwd,
        packageRoot: options.packageRoot,
      }),
  );
  return {
    ready: cloakbrowserUrl !== undefined && playwrightCoreUrl !== undefined,
    ...(cloakbrowserUrl === undefined ? {} : { cloakbrowserUrl }),
    ...(playwrightCoreUrl === undefined ? {} : { playwrightCoreUrl }),
  };
}

function firstExisting(urls: readonly string[]): string | undefined {
  for (const url of urls) {
    if (url.startsWith('file://')) {
      try {
        if (existsSync(new URL(url))) return url;
      } catch {
        // Malformed file URL — keep scanning.
      }
      continue;
    }
    return url;
  }
  return undefined;
}