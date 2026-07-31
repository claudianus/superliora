/**
 * Persona settings glance — live active name from config (SSOT §9.2).
 */

import type { PersonaConfig } from '@superliora/sdk';

import { PERSONA_PRESET_NAMES } from '#/tui/commands/persona';

export interface PersonaGlanceInput {
  readonly persona?: PersonaConfig;
  readonly configPath: string;
  readonly configError?: string;
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

/** Live active persona label from config.toml [persona]. */
export function formatActivePersonaLine(persona: PersonaConfig | undefined): string {
  if (isEmptyPersona(persona)) {
    return 'Active persona: default (engine personality)';
  }

  const name = persona?.name?.trim();
  if (name !== undefined && name.length > 0) {
    return `Active persona: ${name}`;
  }

  const preset = persona?.preset;
  if (preset !== undefined && preset !== 'none') {
    return `Active persona: ${preset} (preset)`;
  }

  return 'Active persona: custom (no display name)';
}

function formatPersonaDetailLines(persona: PersonaConfig | undefined): readonly string[] {
  if (isEmptyPersona(persona) || persona === undefined) return [];

  const lines: string[] = [];
  if (persona.preset !== undefined && persona.preset !== 'none') {
    lines.push(`Preset: ${persona.preset}`);
  }
  if (persona.tone !== undefined && persona.tone.trim().length > 0) {
    lines.push(`Tone: ${persona.tone.trim()}`);
  }
  if (persona.personality !== undefined && persona.personality.trim().length > 0) {
    lines.push(`Personality: ${persona.personality.trim()}`);
  }
  if (persona.instructions !== undefined && persona.instructions.trim().length > 0) {
    const trimmed = persona.instructions.trim();
    const preview =
      trimmed.length > 72 ? `${trimmed.slice(0, 71)}…` : trimmed;
    lines.push(`Instructions: ${preview}`);
  }
  return lines;
}

export function buildPersonaSettingsLines(input: PersonaGlanceInput): readonly string[] {
  const activeLine = formatActivePersonaLine(input.persona);
  const detailLines = formatPersonaDetailLines(input.persona);
  const presetList = PERSONA_PRESET_NAMES.join(', ');

  const statusLines =
    input.configError !== undefined
      ? [`Config: (unavailable — ${input.configError})`, activeLine]
      : [`Config: ${input.configPath}`, activeLine, ...detailLines];

  return [
    '── Persona (read-only) ───────────────────────',
    'Agent personality block — Sovereign Reform §9.2.',
    '',
    '── Status (live) ────────────────────────────',
    ...statusLines,
    '',
    '── Presets (tips) ───────────────────────────',
    `· Built-in presets: ${presetList}`,
    '· Apply preset: /persona set <name> or Settings → Persona → /persona',
    '· Custom fields stack on top of preset system prompt text',
    '',
    '── Customize (manual) ───────────────────────',
    '· /persona name <display name> — footer / transcript label',
    '· /persona tone <desc> — warm, formal, concise, …',
    '· /persona personality <traits> — free-form traits block',
    '· /persona instructions <text> — appended behavioral rules',
    '· /persona clear — reset [persona] to engine default',
    '· Persisted in config.toml [persona] · reloads active session',
    '',
    'No inline persona editor here yet — use slash commands or edit config.',
  ];
}
