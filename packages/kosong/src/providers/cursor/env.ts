/** OS / shell fields Cursor embeds in the AgentService environment context. */

import { homedir, platform, release } from 'node:os';
import { resolve } from 'node:path';

/** `RequestContextEnv.os_version` — Cursor CLI sends `platform() + " " + release()`. */
export function cursorEnvironmentOs(): string {
  return `${platform()} ${release()}`;
}

export function cursorEnvironmentShell(): string {
  const fromEnv = process.env['SHELL']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  if (process.platform !== 'win32') return 'bash';
  const comspec = process.env['ComSpec']?.toLowerCase() ?? '';
  if (comspec.endsWith('\\cmd.exe') || comspec.endsWith('/cmd.exe')) return 'cmd';
  return 'powershell';
}

export function cursorEnvironmentTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone.length > 0 ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

export function cursorIsWorkingDirHome(cwd: string): boolean {
  try {
    return resolve(cwd) === resolve(homedir());
  } catch {
    return false;
  }
}
