/**
 * Cursor CLI device fingerprints + `x-cursor-checksum`.
 *
 * Cursor keys device identity off the ids in the checksum header. A new
 * random machineId every process looks like "too many devices" and gets
 * Connect errors. Match the CLI (`host-machine-id`): stable OS identifiers,
 * hashed, with the same Windows REG_SZ / virtual-MAC filters.
 */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

export interface CursorDeviceIds {
  readonly machineId: string;
  readonly macMachineId?: string;
}

const SKIP_MACS = new Set(['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff', 'ac:de:48:00:11:22']);

let cachedIds: CursorDeviceIds | undefined;

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

function readMacOSUUID(): string | undefined {
  try {
    const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 5_000 }).toString();
    const after = out.split('IOPlatformUUID')[1];
    if (after === undefined) return undefined;
    const id = (after.split('\n')[0] ?? '').replaceAll(/[=\s"]+/g, '').toLowerCase();
    return id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

function readLinuxMachineId(): string | undefined {
  // Cursor CLI: `cat /var/lib/dbus/machine-id /etc/machine-id` (dbus first).
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

/** Parse `REG.exe QUERY … /v MachineGuid` the way Cursor CLI does. */
export function parseCursorWindowsMachineGuid(regOutput: string): string | undefined {
  const after = regOutput.split('REG_SZ')[1];
  if (after === undefined) return undefined;
  const guid = after.replaceAll(/\s+/g, '').toLowerCase();
  return guid.length > 0 ? guid : undefined;
}

function windowsRegExe(): string {
  const windir = process.env['windir']?.trim() || process.env['SystemRoot']?.trim() || 'C:\\Windows';
  return join(windir, 'System32', 'REG.exe');
}

function readWindowsMachineGuid(): string | undefined {
  try {
    const out = execFileSync(
      windowsRegExe(),
      ['QUERY', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { timeout: 5_000, windowsHide: true },
    ).toString();
    return parseCursorWindowsMachineGuid(out);
  } catch {
    return undefined;
  }
}

function platformUuid(): string | undefined {
  switch (process.platform) {
    case 'darwin':
      return readMacOSUUID();
    case 'linux':
      return readLinuxMachineId();
    case 'win32':
      return readWindowsMachineGuid();
    default:
      return undefined;
  }
}

/** Stable device fingerprints, derived like the Cursor CLI. Cached per process. */
export function getCursorDeviceIds(): CursorDeviceIds {
  if (cachedIds !== undefined) return cachedIds;
  const mac = firstMacAddress();
  const uuid = platformUuid();
  let machineId: string;
  if (uuid !== undefined && uuid.length > 0) {
    machineId = sha256hex(uuid);
  } else if (mac !== undefined) {
    machineId = sha256hex(mac);
  } else {
    machineId = sha256hex(hostname());
  }
  cachedIds = {
    machineId,
    ...(mac === undefined ? {} : { macMachineId: sha256hex(mac) }),
  };
  return cachedIds;
}

/** Test-only. */
export function resetCursorDeviceIdsForTests(): void {
  cachedIds = undefined;
}

export function obfuscateCursorTimestamp(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  let rolling = 165;
  for (let i = 0; i < out.length; i++) {
    out[i] = ((out[i]! ^ rolling) + (i % 256)) & 0xff;
    rolling = out[i]!;
  }
  return out;
}

/** Build the `x-cursor-checksum` header the Cursor CLI sends on every RPC. */
export function createCursorChecksumHeader(
  machineId: string,
  macMachineId?: string,
  nowMs = Date.now(),
): string {
  const n = Math.floor(nowMs / 1e6);
  const ts = Uint8Array.from([
    (n >> 40) & 0xff,
    (n >> 32) & 0xff,
    (n >> 24) & 0xff,
    (n >> 16) & 0xff,
    (n >> 8) & 0xff,
    n & 0xff,
  ]);
  const prefix = Buffer.from(obfuscateCursorTimestamp(ts)).toString('base64').replace(/=+$/, '');
  return macMachineId !== undefined && macMachineId.length > 0
    ? `${prefix}${machineId}/${macMachineId}`
    : `${prefix}${machineId}`;
}

export function cursorChecksumHeader(nowMs?: number): string {
  const ids = getCursorDeviceIds();
  return createCursorChecksumHeader(ids.machineId, ids.macMachineId, nowMs);
}
