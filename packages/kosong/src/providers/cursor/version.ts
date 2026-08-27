/**
 * Resolve `x-cursor-client-version` the way Cursor CLI does: env override,
 * newest local cursor-agent install, then a pinned fallback.
 */

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { CURSOR_CLIENT_VERSION_DEFAULT } from './constants';

const BUILD_RE = /^\d{4}\.\d{2}\.\d{2}-[0-9A-Za-z][0-9A-Za-z.-]*$/;

function envClientVersion(): string | undefined {
  for (const key of ['SUPERLIORA_CURSOR_CLIENT_VERSION', 'CURSOR_CLIENT_VERSION']) {
    const value = process.env[key]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

export function cursorAgentVersionsDirs(): string[] {
  const home = homedir();
  const dirs = [
    join(home, '.local', 'share', 'cursor-agent', 'versions'),
    join(
      home,
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'globalStorage',
      'anysphere.cursor-agent-worker',
      'agent-cli',
      '.local',
      'share',
      'cursor-agent',
      'versions',
    ),
    join(
      home,
      '.config',
      'Cursor',
      'User',
      'globalStorage',
      'anysphere.cursor-agent-worker',
      'agent-cli',
      '.local',
      'share',
      'cursor-agent',
      'versions',
    ),
  ];
  const localAppData = process.env['LOCALAPPDATA']?.trim();
  if (localAppData !== undefined && localAppData.length > 0) {
    dirs.push(join(localAppData, 'cursor-agent', 'versions'));
  } else {
    dirs.push(join(home, 'AppData', 'Local', 'cursor-agent', 'versions'));
  }
  const appData = process.env['APPDATA']?.trim();
  if (appData !== undefined && appData.length > 0) {
    dirs.push(
      join(
        appData,
        'Cursor',
        'User',
        'globalStorage',
        'anysphere.cursor-agent-worker',
        'agent-cli',
        '.local',
        'share',
        'cursor-agent',
        'versions',
      ),
    );
  }
  return dirs;
}

/** Newest `cli-{build}` directory under a cursor-agent versions root. */
export function discoverLocalCursorClientVersion(dirs = cursorAgentVersionsDirs()): string | undefined {
  let newest: { name: string; mtimeMs: number } | undefined;
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !BUILD_RE.test(entry.name)) continue;
      try {
        const mtimeMs = statSync(join(dir, entry.name)).mtimeMs;
        if (
          newest === undefined ||
          mtimeMs > newest.mtimeMs ||
          (mtimeMs === newest.mtimeMs && entry.name > newest.name)
        ) {
          newest = { name: entry.name, mtimeMs };
        }
      } catch {
        // Directory disappeared during discovery.
      }
    }
  }
  return newest === undefined ? undefined : `cli-${newest.name}`;
}

/** Sync resolve used on every Cursor RPC. */
export function resolveCursorClientVersion(explicit?: string): string {
  const fromArg = explicit?.trim();
  if (fromArg !== undefined && fromArg.length > 0) return fromArg;
  return envClientVersion() ?? discoverLocalCursorClientVersion() ?? CURSOR_CLIENT_VERSION_DEFAULT;
}
