/**
 * Client-side skill enable/disable state (slash activation filter).
 * Persisted at ~/.superliora/skills-state.json — Claude-compatible companion to skill dirs.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { getDataDir } from '#/utils/paths';

export interface SkillsState {
  /** Skill names that must not appear as slash commands / extensions activate. */
  readonly disabled: readonly string[];
}

const DEFAULT_STATE: SkillsState = { disabled: [] };

export function getSkillsStatePath(): string {
  return join(getDataDir(), 'skills-state.json');
}

export async function loadSkillsState(path: string = getSkillsStatePath()): Promise<SkillsState> {
  if (!existsSync(path)) return DEFAULT_STATE;
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as { disabled?: unknown };
    const disabled = Array.isArray(raw.disabled)
      ? raw.disabled.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : [];
    return { disabled };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function saveSkillsState(
  state: SkillsState,
  path: string = getSkillsStatePath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const unique = [...new Set(state.disabled.map((s) => s.trim()).filter((s) => s.length > 0))].sort();
  await writeFile(path, `${JSON.stringify({ disabled: unique }, null, 2)}\n`, 'utf-8');
}

export async function setSkillDisabled(name: string, disabled: boolean): Promise<SkillsState> {
  const state = await loadSkillsState();
  const set = new Set(state.disabled);
  if (disabled) set.add(name);
  else set.delete(name);
  const next = { disabled: [...set] };
  await saveSkillsState(next);
  return next;
}

export function isSkillDisabled(state: SkillsState, name: string): boolean {
  return state.disabled.includes(name);
}
