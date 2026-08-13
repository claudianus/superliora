/**
 * Spawn PATH commands so Windows .cmd shims (corepack, pnpm, liora.cmd)
 * actually start. Node's spawn() cannot exec a .cmd without cmd.exe.
 */

import { spawnSync } from 'node:child_process';
import { extname } from 'node:path';

/**
 * True when `command` must be launched via cmd.exe on Windows.
 * Inject `platform` so the same suite can encode win32/darwin/linux.
 *
 * @param {string} command
 * @param {string} [platform]
 */
export function commandNeedsWindowsShell(command, platform = process.platform) {
  if (platform !== 'win32') return false;
  const ext = extname(command).toLowerCase();
  if (ext === '.exe') return false;
  return true;
}

/**
 * Quote one argv token for `cmd.exe /s /c`.
 * @param {unknown} value
 */
export function quoteCmdArgument(value) {
  const s = String(value);
  if (s.length === 0) return '""';
  if (!/[\s"&<>|^()%!]/.test(s)) return s;
  return `"${s.replaceAll('"', '""')}"`;
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 */
export function buildCmdLine(command, args) {
  return [quoteCmdArgument(command), ...args.map(quoteCmdArgument)].join(' ');
}

/**
 * spawnSync wrapper: on Windows, bare names and .cmd/.bat go through cmd.exe.
 * Extra option `platform` is stripped before passing to spawnSync.
 *
 * @param {string} command
 * @param {readonly string[]} [args]
 * @param {import('node:child_process').SpawnSyncOptions & { platform?: string }} [options]
 */
/** Coerce spawn stdout/stderr to a string (encoding: 'utf8' or Buffer). */
export function spawnOutputText(result) {
  const stdout = result?.stdout == null ? '' : String(result.stdout);
  const stderr = result?.stderr == null ? '' : String(result.stderr);
  return `${stdout}${stderr}`;
}

export function spawnInstall(command, args = [], options = {}) {
  const platform = options.platform ?? process.platform;
  const { platform: _ignored, ...spawnOptions } = options;
  if (commandNeedsWindowsShell(command, platform)) {
    const line = buildCmdLine(command, args);
    const comspec = process.env.ComSpec ?? 'cmd.exe';
    return spawnSync(comspec, ['/d', '/s', '/c', `"${line}"`], {
      ...spawnOptions,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(command, args, spawnOptions);
}
