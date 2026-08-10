import {
  NATIVE_INSTALL_COMMAND_UNIX,
  NATIVE_INSTALL_COMMAND_WIN,
  NATIVE_INSTALL_FROM_MAIN_UNIX,
  NATIVE_INSTALL_FROM_MAIN_WIN,
  nativeInstallCommandPinned,
} from '#/constant/app';

import { gitCheckoutUpdateCommand, gitCheckoutUpdateScript } from './git-checkout';
import { NPM_PACKAGE_NAME, type InstallSource } from './types';

export interface InstallSpawnOptions {
  /** Skip releases; install tip of `main` from source. */
  readonly fromMain?: boolean;
  /** Explicit git checkout root (defaults to host package's SuperLiora repo). */
  readonly checkoutRoot?: string;
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

export function canAutoInstall(source: InstallSource, platform: NodeJS.Platform): boolean {
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
      // In-place git checkout update script is POSIX bash today.
      return platform !== 'win32';
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
    case 'github-checkout':
      return {
        cmd: 'bash',
        args: [
          '-lc',
          gitCheckoutUpdateScript(
            options.checkoutRoot,
            fromMain ? { preferredUpstream: 'origin/main' } : {},
          ),
        ],
      };
    case 'native':
      if (platform === 'win32') {
        // Surface irm failures instead of treating an empty pipeline as success.
        return {
          cmd: 'powershell',
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
