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

export function tryGetHostPackageJsonPath(): string | undefined {
  // Native SEA lives under e.g. %LocalAppData%\SuperLiora\bin — walking from
  // there can miss a manifest or pick up an unrelated package.json.
  if (isNativeSeaHost()) return undefined;
  return findPackageJsonNear(MODULE_DIR);
}

export function getHostPackageJsonPath(): string {
  // Walk upwards from this file's directory until a `package.json` shows up,
  // so both dev (`tsx src/main.ts` — this file in `src/cli/`, pkg 2 levels
  // up) and prod (`node dist/main.mjs` — this code bundled into `dist/`,
  // pkg 1 level up) resolve correctly.
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
