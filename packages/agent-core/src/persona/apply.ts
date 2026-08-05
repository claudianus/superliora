/**
 * Persona config → ROLE_ADDITIONAL + preset normalize / atomic apply helpers.
 */

import type { PersonaConfig } from '../config';

import { getPersonaPreset } from './presets';
import type { PersonaPresetId, PersonaPresetInputId } from './types';

const LEGACY_PRESET_ALIASES: Readonly<Record<string, PersonaPresetId>> = {
  concise: 'efficient',
};

/** Map legacy preset ids (e.g. concise → efficient). Unknown strings unchanged. */
export function normalizePersonaPresetId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const alias = LEGACY_PRESET_ALIASES[id];
  return alias ?? id;
}

export function isPersonaPresetId(id: string): id is PersonaPresetId {
  if (id === 'none') return true;
  return getPersonaPreset(id as PersonaPresetId) !== undefined;
}

/**
 * Atomic preset selection patch: sets preset and clears custom override fields.
 * Does not touch `name` (display label is independent).
 */
export function atomicPersonaConfigForPreset(
  preset: PersonaPresetInputId,
): PersonaConfig {
  const normalized = normalizePersonaPresetId(preset);
  const id = (typeof normalized === 'string' ? normalized : 'none') as PersonaPresetId;
  return {
    preset: id,
    personality: '',
    tone: '',
    instructions: '',
  };
}

export function isEmptyPersona(persona: PersonaConfig | undefined): boolean {
  if (persona === undefined) return true;
  return (
    (persona.name === undefined || persona.name.trim().length === 0) &&
    (persona.preset === undefined || persona.preset === 'none') &&
    (persona.personality === undefined || persona.personality.trim().length === 0) &&
    (persona.tone === undefined || persona.tone.trim().length === 0) &&
    (persona.instructions === undefined || persona.instructions.trim().length === 0)
  );
}

/**
 * Compile `[persona]` into a `# Persona` ROLE_ADDITIONAL block.
 * Preset text is the base; non-empty custom fields layer on top (Advanced).
 */
export function buildPersonaRoleAdditional(persona: PersonaConfig | undefined): string | undefined {
  if (persona === undefined) return undefined;

  const parts: string[] = [];
  const rawPreset = persona.preset;
  const presetId = normalizePersonaPresetId(rawPreset);

  if (presetId !== undefined && presetId !== 'none' && isPersonaPresetId(presetId)) {
    const preset = getPersonaPreset(presetId);
    if (preset !== undefined) {
      parts.push(`Personality: ${preset.personality}`);
      parts.push(`Tone: ${preset.tone}`);
      if (preset.instructions !== undefined && preset.instructions.trim().length > 0) {
        parts.push(preset.instructions.trim());
      }
    }
  }

  const customPersonality = persona.personality?.trim() ?? '';
  const customTone = persona.tone?.trim() ?? '';
  const customInstructions = persona.instructions?.trim() ?? '';

  if (customPersonality.length > 0) {
    // Replace preset personality line when overriding, else append.
    const idx = parts.findIndex((line) => line.startsWith('Personality: '));
    const line = `Personality: ${customPersonality}`;
    if (idx >= 0) parts[idx] = line;
    else parts.push(line);
  }
  if (customTone.length > 0) {
    const idx = parts.findIndex((line) => line.startsWith('Tone: '));
    const line = `Tone: ${customTone}`;
    if (idx >= 0) parts[idx] = line;
    else parts.push(line);
  }
  if (customInstructions.length > 0) {
    parts.push(customInstructions);
  }

  if (parts.length === 0) return undefined;

  const header =
    persona.name !== undefined && persona.name.trim().length > 0
      ? `# Persona: ${persona.name.trim()}`
      : '# Persona';

  return `${header}\n\n${parts.join('\n')}`;
}
