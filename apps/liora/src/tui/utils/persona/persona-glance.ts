/**
 * Persona settings glance — live active name from config (SSOT §9.2).
 */

import {
  DEFAULT_PERSONA_PRESET_ID,
  PERSONA_PRESET_CATALOG,
  getPersonaPreset,
  isEmptyPersona,
  normalizePersonaPresetId,
  type PersonaConfig,
} from '@superliora/sdk';

const DEFAULT_PERSONA_LABEL =
  getPersonaPreset(DEFAULT_PERSONA_PRESET_ID)?.label ?? DEFAULT_PERSONA_PRESET_ID;

export const PERSONA_PRESET_TIP =
  'Choose Presets… — atomic apply clears custom overrides and may enable related skills.';

export const PERSONA_CUSTOMIZE_TIP =
  'Advanced: edit name / tone / personality / instructions in Settings → Persona.';

export const PERSONA_PERSIST_TIP =
  'Persisted in config.toml [persona] · skill bundles touch skills-state.json only for listed skills.';

export interface PersonaGlanceInput {
  readonly persona?: PersonaConfig;
  readonly configPath: string;
  readonly configError?: string;
}

export { isEmptyPersona };

function isPersonaOptedOut(persona: PersonaConfig | undefined): boolean {
  return persona?.preset === 'none' && isEmptyPersona(persona);
}

/** Live active persona label from config.toml [persona]. */
export function formatActivePersonaLine(persona: PersonaConfig | undefined): string {
  if (isPersonaOptedOut(persona)) {
    return 'Active persona: disabled (preset = none)';
  }

  if (isEmptyPersona(persona)) {
    return `Active persona: ${DEFAULT_PERSONA_LABEL} (default preset)`;
  }

  const name = persona?.name?.trim();
  if (name !== undefined && name.length > 0) {
    return `Active persona: ${name}`;
  }

  const preset = persona?.preset;
  if (preset !== undefined && preset !== 'none') {
    const id = normalizePersonaPresetId(preset);
    return `Active persona: ${id} (preset)`;
  }

  return 'Active persona: custom (no display name)';
}

function formatPersonaDetailLines(persona: PersonaConfig | undefined): readonly string[] {
  if (isPersonaOptedOut(persona)) {
    return ['Preset: none (personas disabled)'];
  }

  if (isEmptyPersona(persona) || persona === undefined) return [];

  const lines: string[] = [];
  if (persona.preset !== undefined && persona.preset !== 'none') {
    lines.push(`Preset: ${normalizePersonaPresetId(persona.preset)}`);
  }
  if (persona.tone !== undefined && persona.tone.trim().length > 0) {
    lines.push(`Tone: ${persona.tone.trim()}`);
  }
  if (persona.personality !== undefined && persona.personality.trim().length > 0) {
    lines.push(`Personality: ${persona.personality.trim()}`);
  }
  if (persona.instructions !== undefined && persona.instructions.trim().length > 0) {
    const trimmed = persona.instructions.trim();
    const preview = trimmed.length > 72 ? `${trimmed.slice(0, 71)}…` : trimmed;
    lines.push(`Instructions: ${preview}`);
  }
  return lines;
}

export function buildPersonaSettingsLines(input: PersonaGlanceInput): readonly string[] {
  const activeLine = formatActivePersonaLine(input.persona);
  const detailLines = formatPersonaDetailLines(input.persona);
  const presetList = PERSONA_PRESET_CATALOG.map((p) => p.id).join(', ');

  const statusLines =
    input.configError !== undefined
      ? [`Config: (unavailable — ${input.configError})`, activeLine]
      : [`Config: ${input.configPath}`, activeLine, ...detailLines];

  return [
    '── Persona ───────────────────────────────────',
    'Main-agent tone & style · preset-first customization.',
    '',
    '── Status (live) ────────────────────────────',
    ...statusLines,
    '',
    '── Presets ──────────────────────────────────',
    `· ${presetList}`,
    '· Settings → Persona → Presets… (atomic apply)',
    '· Skill bundles enable listed skills only (no global wipe)',
    '',
    '── Advanced ─────────────────────────────────',
    '· Name, tone, personality, instructions — Settings → Persona',
    '· Clear removes [persona]; skill toggles stay as-is',
    `· ${PERSONA_PERSIST_TIP}`,
  ];
}
