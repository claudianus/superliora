/**
 * Ensure pnpm is available: Corepack first, then a user-local standalone binary.
 * Corepack is often missing, unsigned, or blocked (`Cannot find matching keyid`)
 * on Windows — never fail the installer asking the user to enable it by hand.
 */

import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { downloadToFile } from './download.mjs';
import { applyUserPathWin } from './path.mjs';
import {
  DEFAULT_PNPM_VERSION,
  defaultRuntimePnpmDir,
  pnpmRuntimeBin,
  pnpmStandaloneFilename,
  pnpmStandaloneUrl,
} from './platform.mjs';
import { spawnInstall } from './spawn.mjs';

export function corepackEnv(env = process.env) {
  return {
    ...env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  };
}

/**
 * @returns {{ cmd: string, prefix: string[], version?: string, source: string } | null}
 */
export function resolvePnpm(options = {}) {
  const env = corepackEnv(options.env ?? process.env);
  const spawn = options.spawnInstall ?? spawnInstall;
  const cwd = options.cwd;
  const probeOpts = { encoding: 'utf8', env, cwd };

  const corepack = spawn('corepack', ['pnpm', '--version'], probeOpts);
  if (corepack.status === 0) {
    return {
      cmd: 'corepack',
      prefix: ['pnpm'],
      version: String(corepack.stdout ?? '').trim(),
      source: 'corepack',
    };
  }

  const direct = spawn('pnpm', ['--version'], probeOpts);
  if (direct.status === 0) {
    return {
      cmd: 'pnpm',
      prefix: [],
      version: String(direct.stdout ?? '').trim(),
      source: 'path',
    };
  }

  const platform = options.platform ?? process.platform;
  const runtimeDir = options.runtimeDir ?? defaultRuntimePnpmDir();
  const marker = pnpmRuntimeBin(runtimeDir, platform);
  const isFile = options.isFile ?? ((p) => existsSync(p));
  if (isFile(marker)) {
    const probe = spawn(marker, ['--version'], probeOpts);
    if (probe.status === 0) {
      prependPnpmRuntimePath(runtimeDir, platform, options);
      return {
        cmd: marker,
        prefix: [],
        version: String(probe.stdout ?? '').trim(),
        source: 'runtime',
      };
    }
  }
  return null;
}

/**
 * @returns {Promise<{
 *   cmd?: string,
 *   prefix?: string[],
 *   version?: string,
 *   source?: string,
 *   bootstrapped: boolean,
 *   skipped?: boolean,
 *   missing?: boolean,
 * }>}
 */
export async function ensurePnpm(options = {}) {
  if (options.skip === true || process.env.SUPERLIORA_SKIP_PNPM === '1') {
    const existing = resolvePnpm(options);
    if (existing) return { ...existing, bootstrapped: false, skipped: true };
    return { bootstrapped: false, skipped: true, missing: true };
  }

  const existing = resolvePnpm(options);
  if (existing) return { ...existing, bootstrapped: false };

  tryCorepackPrepare(options);
  const afterCorepack = resolvePnpm(options);
  if (afterCorepack) return { ...afterCorepack, bootstrapped: true };

  return bootstrapStandalonePnpm(options);
}

function tryCorepackPrepare(options) {
  const env = corepackEnv(options.env ?? process.env);
  const spawn = options.spawnInstall ?? spawnInstall;
  const cwd = options.cwd;
  const version = options.version ?? DEFAULT_PNPM_VERSION;
  const opts = { encoding: 'utf8', env, cwd };
  spawn('corepack', ['enable'], opts);
  spawn('corepack', ['enable', 'pnpm'], opts);
  spawn('corepack', ['prepare', `pnpm@${version}`, '--activate'], opts);
}

async function bootstrapStandalonePnpm(options) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const version = options.version ?? DEFAULT_PNPM_VERSION;
  const runtimeDir = options.runtimeDir ?? defaultRuntimePnpmDir();
  const dest = pnpmRuntimeBin(runtimeDir, platform);
  const url = pnpmStandaloneUrl(version, platform, arch);
  const isFile = options.isFile ?? ((p) => existsSync(p));

  if (!isFile(dest)) {
    await mkdir(runtimeDir, { recursive: true });
    const download = options.downloadToFile ?? downloadToFile;
    const tmp = join(runtimeDir, pnpmStandaloneFilename(platform, arch));
    await download(url, tmp);
    if (tmp !== dest) {
      try {
        await rename(tmp, dest);
      } catch {
        await copyFile(tmp, dest);
        await rm(tmp, { force: true }).catch(() => {});
      }
    }
    if (platform !== 'win32') {
      await chmod(dest, 0o755).catch(() => {});
    }
  }

  if (!(options.isFile ?? ((p) => existsSync(p)))(dest) && !existsSync(dest)) {
    throw new Error(`pnpm bootstrap failed: missing ${dest}`);
  }

  prependPnpmRuntimePath(runtimeDir, platform, options);

  const spawn = options.spawnInstall ?? spawnInstall;
  const probe = spawn(dest, ['--version'], {
    encoding: 'utf8',
    env: corepackEnv(options.env ?? process.env),
  });
  if (probe.status !== 0) {
    throw new Error(`pnpm bootstrap failed: ${dest} --version exited ${probe.status}`);
  }

  return {
    cmd: dest,
    prefix: [],
    version: String(probe.stdout ?? '').trim(),
    source: 'runtime',
    bootstrapped: true,
  };
}

function prependPnpmRuntimePath(runtimeDir, platform, options = {}) {
  const sep = platform === 'win32' ? ';' : ':';
  process.env.PATH = `${runtimeDir}${sep}${process.env.PATH ?? ''}`;
  if (options.noShellRc) return;
  if (platform === 'win32') {
    try {
      applyUserPathWin(runtimeDir);
    } catch {
      // Session PATH is enough for this install process.
    }
  }
}

export function runPnpm(args, options = {}) {
  const pnpm = resolvePnpm(options);
  if (!pnpm) {
    return { status: 1, error: new Error('pnpm is not available') };
  }
  return (options.spawnInstall ?? spawnInstall)(pnpm.cmd, [...pnpm.prefix, ...args], {
    cwd: options.cwd,
    env: corepackEnv(options.env ?? process.env),
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio,
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  ensurePnpm()
    .then((info) => {
      if (!info.cmd) {
        process.stderr.write('error: pnpm bootstrap failed\n');
        process.exit(1);
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`error: ${message}\n`);
      process.exit(1);
    });
}
