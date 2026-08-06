/**
 * Harness state persistence.
 *
 * Local scope rides the session record log (`harness.state` snapshot records,
 * last one wins on replay) so fork/resume carry it for free. Global scope is
 * a JSON file under the liora home dir shared by every session.
 */

import { homedir } from 'node:os';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'pathe';

import { atomicWrite } from '../../utils/fs';
import {
  HARNESS_STATE_SCHEMA,
  emptyHarnessState,
  type HarnessState,
} from './state';

export const GLOBAL_HARNESS_RELATIVE_PATH = join('harness', 'harness_state.json');

/** Same resolution as the oauth toolkit: SUPERLIORA_HOME, else ~/.superliora. */
export function resolveGlobalLioraHome(): string {
  const override = process.env['SUPERLIORA_HOME'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), '.superliora');
}

export function globalHarnessStatePath(homeDir: string): string {
  return join(homeDir, GLOBAL_HARNESS_RELATIVE_PATH);
}

/** Corrupt-tolerant load: a broken file falls back to empty state. */
export async function loadGlobalHarnessState(homeDir: string): Promise<HarnessState> {
  const filePath = globalHarnessStatePath(homeDir);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return emptyHarnessState();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeHarnessState(parsed);
  } catch {
    return emptyHarnessState();
  }
}

export async function saveGlobalHarnessState(
  homeDir: string,
  state: HarnessState,
): Promise<void> {
  const filePath = globalHarnessStatePath(homeDir);
  await mkdir(dirname(filePath), { recursive: true });
  await atomicWrite(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

/** Accept only the fields the runtime owns; ignore unknown/extra data. */
export function normalizeHarnessState(input: unknown): HarnessState {
  if (typeof input !== 'object' || input === null) return emptyHarnessState();
  const candidate = input as Partial<HarnessState>;
  if (candidate.schema !== HARNESS_STATE_SCHEMA) return emptyHarnessState();
  return {
    schema: HARNESS_STATE_SCHEMA,
    entries: Array.isArray(candidate.entries) ? candidate.entries : [],
    refinements: Array.isArray(candidate.refinements) ? candidate.refinements : [],
  };
}
