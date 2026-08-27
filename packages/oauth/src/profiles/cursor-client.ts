/** Shared Cursor CLI client identity (auth headers + AvailableModels RPC). */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { hostname, homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';

export const CURSOR_CLIENT_TYPE = 'cli';
export const CURSOR_CLIENT_VERSION_DEFAULT = 'cli-2026.08.25-3e8eec8';

const BUILD_RE = /^\d{4}\.\d{2}\.\d{2}-[0-9A-Za-z][0-9A-Za-z.-]*$/;
const SKIP_MACS = new Set(['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff', 'ac:de:48:00:11:22']);

let cachedDeviceIds: { machineId: string; macMachineId?: string } | undefined;

function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function usableMac(mac: string): boolean {
  const normalized = mac.replaceAll('-', ':').toLowerCase();
  return mac.length > 0 && !SKIP_MACS.has(normalized);
}

function firstMacAddress(): string | undefined {
  try {
    const ifaces = networkInterfaces();
    for (const list of Object.values(ifaces)) {
      if (list === undefined) continue;
      for (const ni of list) {
        if (usableMac(ni.mac)) return ni.mac;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

function parseWindowsMachineGuid(regOutput: string): string | undefined {
  const after = regOutput.split('REG_SZ')[1];
  if (after === undefined) return undefined;
  const guid = after.replaceAll(/\s+/g, '').toLowerCase();
  return guid.length > 0 ? guid : undefined;
}

function windowsRegExe(): string {
  const windir = process.env['windir']?.trim() || process.env['SystemRoot']?.trim() || 'C:\\Windows';
  return join(windir, 'System32', 'REG.exe');
}

function platformUuid(): string | undefined {
  try {
    if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 5_000 }).toString();
      const after = out.split('IOPlatformUUID')[1];
      const id = (after?.split('\n')[0] ?? '').replaceAll(/[=\s"]+/g, '').toLowerCase();
      return id.length > 0 ? id : undefined;
    }
    if (process.platform === 'linux') {
      for (const file of ['/var/lib/dbus/machine-id', '/etc/machine-id']) {
        try {
          const value = readFileSync(file, 'utf8').trim();
          if (value.length > 0) return value;
        } catch {
          // ignore
        }
      }
      return undefined;
    }
    if (process.platform === 'win32') {
      const out = execFileSync(
        windowsRegExe(),
        ['QUERY', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { timeout: 5_000, windowsHide: true },
      ).toString();
      return parseWindowsMachineGuid(out);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function cursorDeviceIds(): { machineId: string; macMachineId?: string } {
  if (cachedDeviceIds !== undefined) return cachedDeviceIds;
  const mac = firstMacAddress();
  const uuid = platformUuid();
  const machineId =
    uuid !== undefined && uuid.length > 0
      ? sha256hex(uuid)
      : mac !== undefined
        ? sha256hex(mac)
        : sha256hex(hostname());
  cachedDeviceIds = {
    machineId,
    ...(mac === undefined ? {} : { macMachineId: sha256hex(mac) }),
  };
  return cachedDeviceIds;
}

function obfuscate(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  let rolling = 165;
  for (let i = 0; i < out.length; i++) {
    out[i] = ((out[i]! ^ rolling) + (i % 256)) & 0xff;
    rolling = out[i]!;
  }
  return out;
}

export function createCursorChecksumHeader(nowMs = Date.now()): string {
  const ids = cursorDeviceIds();
  const n = Math.floor(nowMs / 1e6);
  const ts = Uint8Array.from([
    (n >> 40) & 0xff,
    (n >> 32) & 0xff,
    (n >> 24) & 0xff,
    (n >> 16) & 0xff,
    (n >> 8) & 0xff,
    n & 0xff,
  ]);
  const prefix = Buffer.from(obfuscate(ts)).toString('base64').replace(/=+$/, '');
  return ids.macMachineId !== undefined
    ? `${prefix}${ids.machineId}/${ids.macMachineId}`
    : `${prefix}${ids.machineId}`;
}

function cursorAgentVersionsDirs(): string[] {
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

export function discoverLocalCursorClientVersion(): string | undefined {
  let newest: { name: string; mtimeMs: number } | undefined;
  for (const dir of cursorAgentVersionsDirs()) {
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
        // ignore
      }
    }
  }
  return newest === undefined ? undefined : `cli-${newest.name}`;
}

export function resolveCursorClientVersion(): string {
  const fromEnv =
    process.env['SUPERLIORA_CURSOR_CLIENT_VERSION']?.trim() ??
    process.env['CURSOR_CLIENT_VERSION']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return discoverLocalCursorClientVersion() ?? CURSOR_CLIENT_VERSION_DEFAULT;
}

/** Static headers identifying a Cursor CLI session for Connect-RPC calls. */
export function cursorAuthHeaders(): Record<string, string> {
  return {
    'x-cursor-client-type': CURSOR_CLIENT_TYPE,
    'x-cursor-client-version': resolveCursorClientVersion(),
    'x-cursor-checksum': createCursorChecksumHeader(),
    'x-ghost-mode': 'true',
  };
}
