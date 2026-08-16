import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Browser } from 'playwright-core';

export type CloakBrowserLaunch = (options: never) => Promise<Browser | undefined>;

/**
 * Resolve `cloakbrowser.launch` for runtime use.
 *
 * SEA/native bundles rewrite `import('cloakbrowser')` into an esbuild
 * `(init_dist(), dist_exports)` shim. That path has failed in the field with
 * `Cannot read properties of undefined (reading 'launch')` when the bundled
 * live binding is not ready. Prefer loading the real package from disk
 * (install layout places it next to the CLI) via a non-literal dynamic import
 * so the bundler cannot rewrite it.
 */
export async function resolveCloakBrowserLaunch(
  options: {
    readonly execPath?: string | undefined;
    readonly cwd?: string | undefined;
    readonly packageRoot?: string | undefined;
    readonly installRoot?: string | undefined;
    /** Test seam: skip disk discovery and use these module URLs only. */
    readonly importUrls?: readonly string[] | undefined;
    /** Test seam: replace a disk-file import (never a package specifier). */
    readonly importModule?: ((url: string) => Promise<unknown>) | undefined;
  } = {},
): Promise<CloakBrowserLaunch> {
  const diskUrls = options.importUrls ?? resolveCloakbrowserImportUrls({
    execPath: options.execPath,
    cwd: options.cwd,
    packageRoot: options.packageRoot ?? options.installRoot,
  });
  const load = options.importModule ?? ((url: string) => import(url));
  const errors: string[] = [];

  for (const url of diskUrls) {
    try {
      const mod: unknown = await load(url);
      const launch = pickLaunch(mod);
      if (launch !== undefined) return launch;
      errors.push(`${url}: launch missing (keys: ${moduleKeys(mod).join(', ') || '(none)'})`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${url}: ${detail}`);
    }
  }

  const detail = errors.length > 0 ? errors.join('; ') : 'no cloakbrowser package found on disk';
  throw new Error(
    `cloakbrowser.launch is unavailable (${detail}). ` +
      'Install cloakbrowser next to the CLI (node_modules/cloakbrowser) or run `liora browser-use doctor`. ' +
      'SEA bundles must not fall back to a literal import("cloakbrowser") shim.',
  );
}

/** Test / diagnostics: list candidate file URLs without importing. */
export function resolveCloakbrowserImportUrls(
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
    addFile(resolvePackageEntry(join(root, 'cloakbrowser')));
  }

  return urls;
}

export function pickLaunch(mod: unknown): CloakBrowserLaunch | undefined {
  if (mod === null || typeof mod !== 'object') return undefined;
  const record = mod as Record<string, unknown>;
  const direct = record['launch'];
  if (typeof direct === 'function') return direct as CloakBrowserLaunch;
  const defaultExport = record['default'];
  if (defaultExport !== null && typeof defaultExport === 'object') {
    const nested = (defaultExport as Record<string, unknown>)['launch'];
    if (typeof nested === 'function') return nested as CloakBrowserLaunch;
  }
  if (typeof defaultExport === 'function' && 'launch' in defaultExport) {
    const nested = (defaultExport as { launch?: unknown }).launch;
    if (typeof nested === 'function') return nested as CloakBrowserLaunch;
  }
  return undefined;
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
    const resolved = join(dir);
    if (seen.has(resolved) || !existsSync(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };

  const execDir = dirname(options.execPath);
  // Install layout: <root>/bin/liora.exe + <root>/node_modules/cloakbrowser
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
      const pkgJson = requireFrom.resolve('cloakbrowser/package.json');
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
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
        readonly exports?: unknown;
        readonly module?: string;
        readonly main?: string;
      };
      const fromExports = entryFromExports(pkg.exports);
      if (fromExports !== undefined) {
        const absolute = join(packageRoot, fromExports);
        if (existsSync(absolute)) return absolute;
      }
      for (const field of [pkg.module, pkg.main]) {
        if (typeof field === 'string' && field.length > 0) {
          const absolute = join(packageRoot, field);
          if (existsSync(absolute)) return absolute;
        }
      }
    } catch {
      // Fall through to default entry.
    }
  }
  return join(packageRoot, 'dist', 'index.js');
}

function entryFromExports(exportsField: unknown): string | undefined {
  if (typeof exportsField === 'string') return exportsField;
  if (exportsField === null || typeof exportsField !== 'object') return undefined;
  const root = (exportsField as Record<string, unknown>)['.'];
  if (typeof root === 'string') return root;
  if (root !== null && typeof root === 'object') {
    const map = root as Record<string, unknown>;
    for (const key of ['import', 'default', 'require']) {
      const value = map[key];
      if (typeof value === 'string') return value;
      if (value !== null && typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        if (typeof nested['default'] === 'string') return nested['default'];
      }
    }
  }
  return undefined;
}

function moduleKeys(mod: unknown): string[] {
  if (mod === null || typeof mod !== 'object') return [];
  return Object.keys(mod);
}
