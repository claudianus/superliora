/**
 * Soft-fail sidecars: browser-use, computer-use, retrieval bootstrap.
 *
 * Each step has a wall-clock timeout and never reads stdin. Upgrade Studio
 * pipes the installer with stdin ignored; a prompt would sit on Sidecars
 * at 90% until the user killed the window.
 */

import { existsSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { ensurePnpm, runPnpm } from './ensure-pnpm.mjs';
import { detectInstallLocale } from './locale.mjs';
import {
  OPTIONAL_INSTALL_TIMEOUT_MS,
  SIDECAR_BUDGET_MS,
  defaultHome,
  observedUpgradeRequested,
} from './platform.mjs';
import { spawnInstall, spawnTimedOut } from './spawn.mjs';
import { t } from './strings.mjs';

export { OPTIONAL_INSTALL_TIMEOUT_MS as SIDECAR_STEP_TIMEOUT_MS, SIDECAR_BUDGET_MS };

/** stdin closed so pnpm / cloakbrowser / cua cannot wait for a TTY prompt. */
const SIDECAR_STDIO = ['ignore', 'inherit', 'inherit'];

/**
 * @param {{
 *   installDir?: string,
 *   commandName?: string,
 *   noBrowserUse?: boolean,
 *   noComputerUse?: boolean,
 *   noRetrieval?: boolean,
 *   onDetail?: (msg: string) => void,
 *   onWarn?: (msg: string) => void,
 *   locale?: string,
 *   env?: NodeJS.ProcessEnv,
 *   platform?: string,
 *   arch?: string,
 *   stepTimeoutMs?: number,
 *   budgetMs?: number,
 *   now?: () => number,
 *   spawnInstall?: typeof spawnInstall,
 *   runPnpm?: typeof runPnpm,
 *   ensurePnpm?: typeof ensurePnpm,
 *   downloadToFile?: typeof downloadToFile,
 * }} options
 */
export async function installSidecars(options = {}) {
  const commandName = options.commandName ?? 'liora';
  const installDir = options.installDir;
  const locale = options.locale ?? detectInstallLocale();
  const env = options.env ?? process.env;
  const warn = options.onWarn ?? (() => {});
  const detail = options.onDetail ?? (() => {});
  if (observedUpgradeRequested(env)) {
    warn(
      'sidecar downloads skipped (observed upgrade has no stdin); run browser-use / computer-use install after restart',
    );
    return;
  }
  const startedAt = sidecarNow(options);

  const needsPnpm =
    (!options.noBrowserUse && env.SUPERLIORA_SKIP_BROWSER_USE !== '1') ||
    (!options.noRetrieval && env.SUPERLIORA_SKIP_RETRIEVAL !== '1');
  if (needsPnpm) {
    if (!budgetLeft(options, startedAt)) {
      warn('sidecar budget exhausted; skipped browser / computer / retrieval');
      return;
    }
    try {
      const ensure = options.ensurePnpm ?? ensurePnpm;
      await ensure({ cwd: installDir, noShellRc: true, spawnInstall: options.spawnInstall, env });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`pnpm bootstrap failed (${message}); sidecar npm steps may skip`);
    }
  }

  if (!options.noBrowserUse && env.SUPERLIORA_SKIP_BROWSER_USE !== '1') {
    if (!budgetLeft(options, startedAt)) {
      warn('sidecar budget exhausted; skipped browser-use, computer-use, retrieval');
      return;
    }
    detail(t('install.sidecar.browserUse', undefined, locale));
    await installBrowserSidecars(installDir, commandName, warn, options);
  }

  if (!options.noComputerUse && env.SUPERLIORA_SKIP_COMPUTER_USE !== '1') {
    if (!budgetLeft(options, startedAt)) {
      warn('sidecar budget exhausted; skipped computer-use, retrieval');
      return;
    }
    detail(t('install.sidecar.cua', undefined, locale));
    installCuaDriver(commandName, warn, options);
  }

  if (!options.noRetrieval && env.SUPERLIORA_SKIP_RETRIEVAL !== '1') {
    if (!budgetLeft(options, startedAt)) {
      warn('sidecar budget exhausted; skipped retrieval');
      return;
    }
    detail(t('install.sidecar.retrieval', undefined, locale));
    if (installDir && existsSync(join(installDir, 'packages/agent-core'))) {
      bootstrapRetrieval(installDir, warn, options);
    } else {
      warn(
        'retrieval bootstrap skipped (no source tree); run after source install or `liora` will hash-fallback',
      );
    }
  }
}

async function installBrowserSidecars(installDir, commandName, warn, options) {
  await installLightpanda(warn, options);
  const env = sidecarEnv(options.env ?? process.env);

  // SEA/native: cloakbrowser + playwright-core must live next to the binary
  // (`<installDir>/node_modules/...`) so launch is not the inlined init_dist shim.
  if (installDir) {
    const modules = runSidecarPnpm(
      ['add', '--ignore-workspace', 'cloakbrowser@0.5.5', 'playwright-core@1.61.1'],
      options,
      { cwd: installDir, env },
    );
    if (modules.status !== 0) {
      warnStep(
        warn,
        modules,
        `cloakbrowser/playwright-core sidecar install failed; retry with '${commandName} browser-use install'`,
      );
    }
  }

  if (installDir && existsSync(join(installDir, 'package.json'))) {
    const cloak = runSidecarPnpm(
      ['--filter', '@superliora/gui-use', 'exec', 'cloakbrowser', 'install'],
      options,
      { cwd: installDir, env },
    );
    if (cloak.status !== 0) {
      warnStep(
        warn,
        cloak,
        `CloakBrowser pre-install failed; retry with '${commandName} browser-use install'`,
      );
    }
    const cam = runSidecarPnpm(
      ['--filter', '@superliora/gui-use', 'exec', 'camoufox', 'fetch'],
      options,
      { cwd: installDir, env },
    );
    if (cam.status !== 0) {
      // camoufox CLI may be `python -m` in some setups — soft fail
      warnStep(
        warn,
        cam,
        `Camoufox pre-install failed; retry with '${commandName} browser-use install'`,
      );
    }
  } else if (!installDir) {
    warn('browser npm caches skipped (no install dir); run `liora browser-use install` after first launch');
  }
}

async function installLightpanda(warn, options) {
  const asset = lightpandaAsset(options.platform ?? process.platform, options.arch ?? process.arch);
  if (!asset) {
    warn('Lightpanda auto-install is not supported on this platform; CloakBrowser fallback only');
    return;
  }
  const cache = (options.env ?? process.env).LIGHTPANDA_CACHE_DIR
    ?? join(defaultHome(), '.cache', 'superliora-lightpanda');
  await mkdir(cache, { recursive: true });
  const platform = options.platform ?? process.platform;
  const target = join(cache, platform === 'win32' ? 'lightpanda.exe' : 'lightpanda');
  try {
    const download = options.downloadToFile ?? downloadToFile;
    await download(
      `https://github.com/lightpanda-io/browser/releases/download/nightly/${asset}`,
      target,
      { timeoutMs: stepTimeoutMs(options) },
    );
    if (platform !== 'win32') await chmod(target, 0o755);
  } catch {
    warn('Lightpanda pre-install failed; retry with browser-use install');
  }
}

function lightpandaAsset(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'lightpanda-aarch64-macos';
  if (platform === 'darwin' && arch === 'x64') return 'lightpanda-x86_64-macos';
  if (platform === 'linux' && arch === 'x64') return 'lightpanda-x86_64-linux';
  if (platform === 'linux' && arch === 'arm64') return 'lightpanda-aarch64-linux';
  return null;
}

function installCuaDriver(commandName, warn, options) {
  const spawn = options.spawnInstall ?? spawnInstall;
  const timeout = stepTimeoutMs(options);
  const spawnOpts = {
    encoding: 'utf8',
    stdio: SIDECAR_STDIO,
    timeout,
    windowsHide: true,
  };
  try {
    const platform = options.platform ?? process.platform;
    if (platform === 'win32') {
      const r = spawn(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex',
        ],
        spawnOpts,
      );
      if (r.status !== 0) throw Object.assign(new Error(`exit ${r.status}`), { result: r });
      return;
    }
    if (platform === 'darwin' || platform === 'linux') {
      const r = spawn(
        '/bin/bash',
        ['-c', 'curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh | /bin/bash'],
        spawnOpts,
      );
      if (r.status !== 0) throw Object.assign(new Error(`exit ${r.status}`), { result: r });
      return;
    }
    warn('cua-driver auto-install is not supported on this platform');
  } catch (error) {
    warnStep(
      warn,
      error?.result,
      `cua-driver install failed; retry with '${commandName} computer-use install'`,
    );
  }
}

function bootstrapRetrieval(installDir, warn, options) {
  const env = sidecarEnv({
    ...(options.env ?? process.env),
    SUPERLIORA_RETRIEVAL_EMBEDDER: 'transformers',
  });
  const r = runSidecarPnpm(
    ['-C', 'packages/agent-core', 'run', 'retrieval:bootstrap'],
    options,
    { cwd: installDir, env },
  );
  if (r.status !== 0) {
    warnStep(
      warn,
      r,
      'retrieval bootstrap failed; SearchExpert falls back to hash until online — retry with pnpm -C packages/agent-core run retrieval:bootstrap',
    );
  }
}

function runSidecarPnpm(args, options, extra) {
  const run = options.runPnpm ?? runPnpm;
  return run(args, {
    cwd: extra.cwd,
    env: extra.env,
    encoding: 'utf8',
    stdio: SIDECAR_STDIO,
    timeout: extra.timeout ?? stepTimeoutMs(options),
    windowsHide: true,
    spawnInstall: options.spawnInstall,
  });
}

function sidecarEnv(base = process.env) {
  return {
    ...base,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    CI: '1',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: base.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ?? '1',
  };
}

function sidecarNow(options) {
  return typeof options.now === 'function' ? options.now() : Date.now();
}

function budgetLeft(options, startedAt) {
  const budget = options.budgetMs ?? SIDECAR_BUDGET_MS;
  return budget - (sidecarNow(options) - startedAt) > 1_000;
}

function stepTimeoutMs(options) {
  return options.stepTimeoutMs ?? OPTIONAL_INSTALL_TIMEOUT_MS;
}

function warnStep(warn, result, message) {
  if (spawnTimedOut(result)) {
    warn(`${message} (timed out)`);
    return;
  }
  warn(message);
}
