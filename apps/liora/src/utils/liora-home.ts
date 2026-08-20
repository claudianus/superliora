/**
 * Relocate the SuperLiora data home and persist the pointer so the next
 * launch (and Windows User env) follows the new path.
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  defaultLioraHomePointerDir,
  LIORA_HOME_REDIRECT_FILE,
  sameHomePath,
  writeLioraHomeRedirect,
} from '@superliora/sdk';

import { SUPERLIORA_HOME_ENV } from '#/constant/app';

export interface RelocateLioraHomeResult {
  readonly from: string;
  readonly to: string;
  readonly copied: number;
}

export async function relocateLioraHome(input: {
  readonly from: string;
  readonly to: string;
  readonly osHome?: string;
}): Promise<RelocateLioraHomeResult> {
  const from = resolve(input.from);
  const to = resolve(input.to);
  if (!isAbsolute(to)) {
    throw new Error(`data home must be an absolute path: ${input.to}`);
  }
  if (sameHomePath(from, to)) {
    persistLioraHomeEnv(to);
    writeLioraHomeRedirect(to, input.osHome ?? homedir());
    return { from, to, copied: 0 };
  }
  const prefix = from.endsWith('\\') || from.endsWith('/') ? from : `${from}\\`;
  const posixPrefix = from.endsWith('/') ? from : `${from}/`;
  if (to === from || to.startsWith(prefix) || to.startsWith(posixPrefix)) {
    throw new Error('cannot move the data home into itself');
  }

  await mkdir(to, { recursive: true });
  let copied = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(from);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (name === LIORA_HOME_REDIRECT_FILE) continue;
    await cp(join(from, name), join(to, name), { recursive: true, force: true });
    copied += 1;
  }
  writeLioraHomeRedirect(to, input.osHome ?? homedir());
  persistLioraHomeEnv(to);
  return { from, to, copied };
}

export function persistLioraHomeEnv(target: string): void {
  process.env[SUPERLIORA_HOME_ENV] = target;
  if (process.platform !== 'win32') return;
  if (process.env['VITEST'] === 'true') return;
  const payload = Buffer.from(JSON.stringify({ value: target }), 'utf8').toString('base64');
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$ErrorActionPreference = 'Stop'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
[Environment]::SetEnvironmentVariable('SUPERLIORA_HOME', [string]$spec.value, 'User')`,
    ],
    { encoding: 'utf8' },
  );
}

export function suggestedHomeOnVolume(volumePath: string): string {
  const root = String(volumePath);
  if (/^[A-Za-z]:[\\/]?$/u.test(root) || /^[A-Za-z]:\\/u.test(root)) {
    const drive = root.slice(0, 2);
    return `${drive}\\SuperLiora`;
  }
  return join(defaultLioraHomePointerDir(), 'alt');
}
