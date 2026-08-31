/**
 * Disk-based playwright-core loader for SEA / installed builds.
 *
 * The SEA bundle keeps `playwright-core` external by design (see
 * apps/liora/tsdown.native.config.ts) so a literal `import('playwright-core')`
 * must resolve from node_modules next to the installed binary. When the
 * sidecar install was skipped or failed, that walk-up fails with a bare
 * ERR_MODULE_NOT_FOUND and VerifySurface dies with `visual=failed` even though
 * the worker's own measurements passed. This resolver mirrors
 * `cloak-browser-launch.ts`: it walks the documented install roots, loads the
 * package entry through a non-literal file-URL import the bundler cannot
 * rewrite, and reports every root it tried on failure.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Minimal shape the two browser runtimes need from playwright-core. */
export type PlaywrightCoreModule = typeof import('playwright-core');

export interface ResolvePlaywrightCoreOptions {
  readonly execPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly packageRoot?: string | undefined;
  /** Test seam — overrides the dynamic import. */
  readonly importModule?: (url: string) => Promise<unknown>;
}

/** Resolve + import playwright-core from disk. Never falls back to a literal specifier. */
export async function loadPlaywrightCore(
  options: ResolvePlaywrightCoreOptions = {},
): Promise<PlaywrightCoreModule> {
  const urls = resolvePlaywrightCoreImportUrls(options);
  const load = options.importModule ?? ((url: string) => import(/* @vite-ignore */ url));
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const mod: unknown = await load(url);
      const chromium = (mod as Record<string, unknown> | null | undefined)?.['chromium'];
      if (chromium === undefined && (mod as Record<string, unknown>)?.['default'] === undefined) {
        errors.push(`${url}: playwright-core entry missing chromium`);
        continue;
      }
      return mod as PlaywrightCoreModule;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${url}: ${detail}`);
    }
  }
  const detail = errors.length > 0 ? errors.join('; ') : 'no playwright-core package found on disk';
  throw new Error(
    `playwright-core is unavailable (${detail}). ` +
      'Repair with `liora browser-use install` (places node_modules/playwright-core next to the CLI) ' +
      'or run `liora browser-use doctor` for diagnostics.',
  );
}

/** Test / diagnostics: candidate file URLs for the playwright-core entry. */
export function resolvePlaywrightCoreImportUrls(
  options: {
    readonly execPath?: string | undefined;
    readonly cwd?: string | undefined;
    readonly packageRoot?: string | undefined;
  } = {},
): readonly string[] {
  const execPath = options.execPath ?? process.execPath;
  const cwd = options.cwd ?? process.cwd();
  const urls: string[] = [];
  const seen = new Set<string>();

  const addFile = (filePath: string): void => {
    if (!isAbsolute(filePath) || !existsSync(filePath)) return;
    const url = pathToFileURL(filePath).href;
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  for (const root of collectNodeModulesRoots({ execPath, cwd, packageRoot: options.packageRoot })) {
    addFile(resolvePackageEntry(join(root, 'playwright-core')));
  }

  return urls;
}

function collectNodeModulesRoots(options: {
  readonly execPath: string;
  readonly cwd: string;
  readonly packageRoot?: string | undefined;
}): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string | undefined): void => {
    if (dir === undefined || dir.length === 0) return;
    if (seen.has(dir) || !existsSync(dir)) return;
    seen.add(dir);
    roots.push(dir);
  };

  const execDir = dirname(options.execPath);
  // Install layout: <root>/bin/liora.exe + <root>/node_modules/playwright-core
  add(join(execDir, '..', 'node_modules'));
  add(join(execDir, 'node_modules'));

  if (options.packageRoot !== undefined) {
    add(join(options.packageRoot, 'node_modules'));
    add(join(options.packageRoot, '..', 'node_modules'));
    add(join(options.packageRoot, '..', '..', 'node_modules'));
  }

  add(join(options.cwd, 'node_modules'));
  add(join(options.cwd, 'packages', 'gui-use', 'node_modules'));

  for (const base of [options.cwd, execDir, join(execDir, '..')]) {
    try {
      const requireFrom = createRequire(join(base, 'package.json'));
      const pkgJson = requireFrom.resolve('playwright-core/package.json');
      add(dirname(dirname(pkgJson)));
    } catch {
      // Not resolvable from this base.
    }
  }

  return roots;
}

function resolvePackageEntry(packageRoot: string): string {
  const pkgJsonPath = join(packageRoot, 'package.json');
  if (existsSync(pkgJsonPath)) {
    try {
      const requireFrom = createRequire(pkgJsonPath);
      return requireFrom.resolve('playwright-core');
    } catch {
      // Fall through to the main-field guess below.
    }
  }
  // pnpm-less layouts: guess the CJS/ESM entry.
  for (const candidate of [
    join(packageRoot, 'index.js'),
    join(packageRoot, 'dist', 'index.js'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return join(packageRoot, 'index.js');
}
