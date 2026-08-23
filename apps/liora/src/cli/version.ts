/**
 * SuperLiora version helpers.
 *
 * `getVersion` reads the host CLI's `package.json#version`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { createKimiDefaultHeaders, type KimiHostIdentity } from '@superliora/oauth';

import { CLI_USER_AGENT_PRODUCT } from '#/constant/app';

import { getDataDir } from '../utils/paths';
import { LIORA_BUILD_INFO } from './build-info';

const MODULE_DIR = import.meta.dirname;
const nodeRequire = createRequire(import.meta.url);

/** True when this process is a packaged native (SEA) binary — no source `package.json`. */
export function isNativeSeaHost(): boolean {
  try {
    const sea = nodeRequire('node:sea') as { isSea?: () => boolean };
    return typeof sea.isSea === 'function' && sea.isSea();
  } catch {
    return false;
  }
}

export interface HostPackageJsonSearchOptions {
  readonly moduleDir?: string | undefined;
  readonly execPath?: string | undefined;
  readonly argv0?: string | undefined;
}

function uniqueExistingDirs(candidates: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0) continue;
    const dir = resolve(candidate);
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

/**
 * Directories to walk for a host `package.json`.
 * Native/SEA hosts often have `isSea() === false` but still ship `bin/package.json`
 * next to `liora.exe`.
 */
export function hostPackageJsonSearchRoots(
  options: HostPackageJsonSearchOptions = {},
): readonly string[] {
  return uniqueExistingDirs([
    options.moduleDir ?? MODULE_DIR,
    dirname(options.execPath ?? process.execPath),
    dirname(options.argv0 ?? process.argv[0] ?? ''),
  ]);
}

function findPackageJsonNear(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function resolveHostPackageJsonPath(
  searchRoots: readonly string[] = hostPackageJsonSearchRoots(),
): string | undefined {
  for (const root of searchRoots) {
    const found = findPackageJsonNear(root);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function tryGetHostPackageJsonPath(): string | undefined {
  return resolveHostPackageJsonPath();
}

export function getHostPackageJsonPath(): string {
  const found = tryGetHostPackageJsonPath();
  if (found !== undefined) return found;
  throw new Error(`Could not locate package.json near ${MODULE_DIR}`);
}

export function tryGetHostPackageRoot(): string | undefined {
  const pkgPath = tryGetHostPackageJsonPath();
  return pkgPath === undefined ? undefined : dirname(pkgPath);
}

export function getHostPackageRoot(): string {
  return dirname(getHostPackageJsonPath());
}

export function getVersion(): string {
  if (LIORA_BUILD_INFO.version !== undefined) {
    return LIORA_BUILD_INFO.version;
  }
  const pkg = JSON.parse(readFileSync(getHostPackageJsonPath(), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
}

export function createLioraHostIdentity(version = getVersion()): KimiHostIdentity {
  return {
    userAgentProduct: CLI_USER_AGENT_PRODUCT,
    version,
  };
}

export function buildLioraDefaultHeaders(version: string): Record<string, string> {
  return createKimiDefaultHeaders({
    homeDir: getDataDir(),
    ...createLioraHostIdentity(version),
  });
}
