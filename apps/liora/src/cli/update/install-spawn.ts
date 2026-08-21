import type { SpawnOptions } from 'node:child_process';
import { dirname } from 'node:path';

import {
  NATIVE_INSTALL_COMMAND_UNIX,
  NATIVE_INSTALL_COMMAND_WIN,
  NATIVE_INSTALL_FROM_MAIN_UNIX,
  NATIVE_INSTALL_FROM_MAIN_WIN,
  nativeInstallCommandPinned,
} from '#/constant/app';

import { gitCheckoutUpdateCommand, gitCheckoutUpdateScript } from './git-checkout';
import { NPM_PACKAGE_NAME, type InstallSource } from './types';
import { findWindowsGitBash } from './windows-git-bash';

/** Mirrors `OBSERVED_UPGRADE_ENV` in `scripts/install/platform.mjs`. */
export const OBSERVED_UPGRADE_ENV = 'SUPERLIORA_OBSERVED_UPGRADE';

export function withObservedUpgradeEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    [OBSERVED_UPGRADE_ENV]: '1',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  };
}

export interface InstallSpawnOptions {
  /** Skip releases; install tip of `main` from source. */
  readonly fromMain?: boolean;
  /** Explicit git checkout root (defaults to host package's SuperLiora repo). */
  readonly checkoutRoot?: string;
  /** Test seam: locate Git for Windows' bash.exe. */
  readonly findWindowsBash?: () => string | null;
}

function withCmdSuffix(base: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${base}.cmd` : base;
}

function bunCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'bun.exe' : 'bun';
}

function nativeInstallCommand(
  platform: NodeJS.Platform,
  fromMain: boolean,
  version: string,
): string {
  if (fromMain) {
    return platform === 'win32' ? NATIVE_INSTALL_FROM_MAIN_WIN : NATIVE_INSTALL_FROM_MAIN_UNIX;
  }
  const trimmed = version.trim().replace(/^v/i, '');
  // Pin when we have a concrete semver so advertise == install.
  if (/^\d+\.\d+\.\d+/.test(trimmed)) {
    return nativeInstallCommandPinned(platform, trimmed);
  }
  return platform === 'win32' ? NATIVE_INSTALL_COMMAND_WIN : NATIVE_INSTALL_COMMAND_UNIX;
}

export function installCommandFor(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
  options: InstallSpawnOptions = {},
): string {
  const fromMain = options.fromMain === true;
  switch (source) {
    case 'npm-global':
      return `npm install -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'pnpm-global':
      return `pnpm add -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'yarn-global':
      return `yarn global add ${NPM_PACKAGE_NAME}@${version}`;
    case 'bun-global':
      return `bun add -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'homebrew':
      // No official Homebrew formula yet — point at the supported installer.
      return nativeInstallCommand(platform, false, version);
    case 'github-checkout':
      return gitCheckoutUpdateCommand(
        options.checkoutRoot,
        fromMain ? { preferredUpstream: 'origin/main' } : {},
      );
    case 'native':
      return nativeInstallCommand(platform, fromMain, version);
    case 'unsupported':
      return fromMain
        ? nativeInstallCommand(platform, true, version)
        : `npm install -g ${NPM_PACKAGE_NAME}@${version}`;
  }
}

export function canAutoInstall(
  source: InstallSource,
  platform: NodeJS.Platform,
  options: Pick<InstallSpawnOptions, 'findWindowsBash'> = {},
): boolean {
  switch (source) {
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
    case 'bun-global':
      return true;
    case 'homebrew':
      // No brew formula; manual reinstall via install script.
      return false;
    case 'github-checkout':
      // The in-place update script is bash. On Windows it runs under Git for
      // Windows' bash.exe (the script already handles USERPROFILE/pnpm.exe),
      // so auto-install is gated on locating it — PATH `bash` is the System32
      // WSL launcher and must never run this script.
      if (platform !== 'win32') return true;
      return (options.findWindowsBash ?? findWindowsGitBash)() !== null;
    case 'native':
      // install.sh / install.ps1 both bootstrap Node and run the orchestrator.
      return true;
    case 'unsupported':
      return false;
  }
}

export interface SpawnCommand {
  readonly cmd: string;
  readonly args: readonly string[];
}

export function spawnForSource(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
  options: InstallSpawnOptions = {},
): SpawnCommand {
  const fromMain = options.fromMain === true;
  switch (source) {
    case 'npm-global':
      return { cmd: withCmdSuffix('npm', platform), args: ['install', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'pnpm-global':
      return { cmd: withCmdSuffix('pnpm', platform), args: ['add', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'yarn-global':
      return { cmd: withCmdSuffix('yarn', platform), args: ['global', 'add', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'bun-global':
      return { cmd: bunCommand(platform), args: ['add', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'homebrew':
      throw new Error('homebrew installs cannot be auto-installed; reinstall via install.sh');
    case 'github-checkout': {
      const script = gitCheckoutUpdateScript(
        options.checkoutRoot,
        fromMain ? { preferredUpstream: 'origin/main' } : {},
      );
      if (platform === 'win32') {
        const gitBash = (options.findWindowsBash ?? findWindowsGitBash)();
        if (gitBash === null) {
          // PATH `bash` on Windows is the System32 WSL launcher — running the
          // script there would operate on a Linux distro's filesystem.
          throw new Error(
            'Git for Windows bash.exe not found; install Git for Windows or run the manual update command',
          );
        }
        return { cmd: gitBash, args: ['-lc', script] };
      }
      return { cmd: 'bash', args: ['-lc', script] };
    }
    case 'native':
      if (platform === 'win32') {
        // Surface irm failures instead of treating an empty pipeline as success.
        // Call powershell.exe directly. `shell: true` on Windows wraps this in
        // cmd.exe, which steals `| iex` and fails with "'iex' is not recognized".
        return {
          cmd: 'powershell.exe',
          args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `$ErrorActionPreference='Stop'; ${nativeInstallCommand('win32', fromMain, version)}`,
          ],
        };
      }
      // `curl … | bash` reports only the trailing bash's exit status, so a
      // failed download (curl can't connect → empty stdin → bash exits 0)
      // would look like a successful update. `pipefail` makes the pipeline
      // surface curl's non-zero status so installUpdate() rejects and we warn
      // instead of printing "Updated …".
      return {
        cmd: 'bash',
        args: ['-c', `set -o pipefail; ${nativeInstallCommand('darwin', fromMain, version)}`],
      };
    case 'unsupported':
      if (fromMain) {
        return spawnForSource('native', version, platform, { fromMain: true });
      }
      throw new Error('unsupported install source cannot be auto-installed');
  }
}

/**
 * Windows `.cmd` shims (npm/pnpm/yarn) need `shell: true` on Node 20+;
 * spawning a batch file without a shell throws EINVAL.
 *
 * Native install is `powershell.exe -Command "… | iex"`. Wrapping that in
 * cmd.exe makes `|` a cmd pipe, so `iex` is "not recognized".
 */
export function spawnOptionsForSource(
  source: InstallSource,
  platform: NodeJS.Platform,
  extra: SpawnOptions,
): SpawnOptions {
  if (platform !== 'win32') return extra;
  switch (source) {
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
      return { ...extra, shell: true };
    case 'github-checkout': {
      // Source installs launch liora through a .cmd wrapper with an embedded
      // node fallback — node is typically *not* on the user's PATH. The update
      // script runs `node scripts/…` inside Git Bash, so hand the child the
      // running node's directory.
      const baseEnv = extra.env ?? process.env;
      const pathKey = Object.keys(baseEnv).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
      const currentPath = baseEnv[pathKey] ?? '';
      const nodeDir = dirname(process.execPath);
      const mergedPath = currentPath.length > 0 ? `${nodeDir};${currentPath}` : nodeDir;
      return { ...extra, env: { ...baseEnv, [pathKey]: mergedPath } };
    }
    default:
      return extra;
  }
}
