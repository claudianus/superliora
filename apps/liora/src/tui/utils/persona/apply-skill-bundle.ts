/**
 * Apply persona preset skillBundle to ~/.superliora/skills-state.json.
 * Does not wipe unrelated disabled skills.
 */

import type { PersonaSkillBundle } from '@superliora/sdk';

import {
  getSkillsStatePath,
  loadSkillsState,
  saveSkillsState,
} from '#/utils/skills/skills-state';

export async function applyPersonaSkillBundle(
  bundle: PersonaSkillBundle | undefined,
  path: string = getSkillsStatePath(),
): Promise<{ enabled: readonly string[]; disabled: readonly string[] }> {
  if (bundle === undefined) {
    return { enabled: [], disabled: [] };
  }

  const enable = bundle.enableSkills ?? [];
  const disable = bundle.disableSkills ?? [];
  if (enable.length === 0 && disable.length === 0) {
    return { enabled: [], disabled: [] };
  }

  const state = await loadSkillsState(path);
  const next = new Set(state.disabled);
  for (const name of enable) next.delete(name);
  for (const name of disable) next.add(name);
  await saveSkillsState({ disabled: [...next] }, path);
  return { enabled: [...enable], disabled: [...disable] };
}
