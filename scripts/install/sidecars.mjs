/**
 * Soft-fail sidecars: browser-use, computer-use, retrieval bootstrap.
 */

import { spawnSync } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { defaultHome } from './platform.mjs';

/**
 * @param {{
 *   installDir?: string,
 *   commandName?: string,
 *   noBrowserUse?: boolean,
 *   noComputerUse?: boolean,
 *   noRetrieval?: boolean,
 *   onDetail?: (msg: string) => void,
 *   onWarn?: (msg: string) => void,
 * }} options
 */
export async function installSidecars(options = {}) {
  const commandName = options.commandName ?? 'liora';
  const installDir = options.installDir;
  const warn = options.onWarn ?? (() => {});
  const detail = options.onDetail ?? (() => {});

  if (!options.noBrowserUse && process.env.SUPERLIORA_SKIP_BROWSER_USE !== '1') {
    detail('Installing browser-use runtimes');
    await installBrowserSidecars(installDir, commandName, warn);
  }

  if (!options.noComputerUse && process.env.SUPERLIORA_SKIP_COMPUTER_USE !== '1') {
    detail('Installing cua-driver');
    installCuaDriver(commandName, warn);
  }

  if (!options.noRetrieval && process.env.SUPERLIORA_SKIP_RETRIEVAL !== '1') {
    detail('Bootstrapping local retrieval embedder');
    if (installDir && existsSync(join(installDir, 'packages/agent-core'))) {
      bootstrapRetrieval(installDir, warn);
    } else {
      warn(
        'retrieval bootstrap skipped (no source tree); run after source install or `liora` will hash-fallback',
      );
    }
  }
}

async function installBrowserSidecars(installDir, commandName, warn) {
  await installLightpanda(warn);
  if (installDir && existsSync(join(installDir, 'package.json'))) {
    const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
    const cloak = spawnSync(
      'corepack',
      ['pnpm', '--filter', '@superliora/gui-use', 'exec', 'cloakbrowser', 'install'],
      { cwd: installDir, env, encoding: 'utf8', stdio: 'inherit' },
    );
    if (cloak.status !== 0) {
      warn(`CloakBrowser pre-install failed; retry with '${commandName} browser-use install'`);
    }
    const cam = spawnSync(
      'corepack',
      ['pnpm', '--filter', '@superliora/gui-use', 'exec', 'camoufox', 'fetch'],
      { cwd: installDir, env, encoding: 'utf8', stdio: 'inherit' },
    );
    if (cam.status !== 0) {
      // camoufox CLI may be `python -m` in some setups — soft fail
      warn(`Camoufox pre-install failed; retry with '${commandName} browser-use install'`);
    }
  } else {
    warn('browser npm caches skipped (no source tree); run `liora browser-use install` after first launch');
  }
}

async function installLightpanda(warn) {
  const asset = lightpandaAsset();
  if (!asset) {
    warn('Lightpanda auto-install is not supported on this platform; CloakBrowser fallback only');
    return;
  }
  const cache = process.env.LIGHTPANDA_CACHE_DIR
    ?? join(defaultHome(), '.cache', 'superliora-lightpanda');
  await mkdir(cache, { recursive: true });
  const target = join(cache, process.platform === 'win32' ? 'lightpanda.exe' : 'lightpanda');
  try {
    await downloadToFile(
      `https://github.com/lightpanda-io/browser/releases/download/nightly/${asset}`,
      target,
    );
    if (process.platform !== 'win32') await chmod(target, 0o755);
  } catch {
    warn('Lightpanda pre-install failed; retry with browser-use install');
  }
}

function lightpandaAsset() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin' && a === 'arm64') return 'lightpanda-aarch64-macos';
  if (p === 'darwin' && a === 'x64') return 'lightpanda-x86_64-macos';
  if (p === 'linux' && a === 'x64') return 'lightpanda-x86_64-linux';
  if (p === 'linux' && a === 'arm64') return 'lightpanda-aarch64-linux';
  return null;
}

function installCuaDriver(commandName, warn) {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex',
        ],
        { encoding: 'utf8', stdio: 'inherit' },
      );
      if (r.status !== 0) throw new Error(`exit ${r.status}`);
      return;
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const r = spawnSync(
        '/bin/bash',
        ['-c', 'curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh | /bin/bash'],
        { encoding: 'utf8', stdio: 'inherit' },
      );
      if (r.status !== 0) throw new Error(`exit ${r.status}`);
      return;
    }
    warn('cua-driver auto-install is not supported on this platform');
  } catch {
    warn(`cua-driver install failed; retry with '${commandName} computer-use install'`);
  }
}

function bootstrapRetrieval(installDir, warn) {
  const env = {
    ...process.env,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    SUPERLIORA_RETRIEVAL_EMBEDDER: 'transformers',
  };
  const r = spawnSync(
    'corepack',
    ['pnpm', '-C', 'packages/agent-core', 'run', 'retrieval:bootstrap'],
    { cwd: installDir, env, encoding: 'utf8', stdio: 'inherit' },
  );
  if (r.status !== 0) {
    warn(
      'retrieval bootstrap failed; SearchExpert falls back to hash until online — retry with pnpm -C packages/agent-core run retrieval:bootstrap',
    );
  }
}
