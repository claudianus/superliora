import type { PersonaConfig } from '@superliora/sdk';

import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESET_NAMES = ['friendly', 'professional', 'concise', 'creative', 'mentor', 'playful'] as const;
type PresetName = (typeof PRESET_NAMES)[number];

const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  friendly: 'Warm, approachable, encouraging — a helpful expert friend',
  professional: 'Precise, thorough, dependable — formal and structured',
  concise: 'Efficient and minimal — fewest words, maximum accuracy',
  creative: 'Imaginative and curious — novel angles, vivid expression',
  mentor: 'Patient and Socratic — guides understanding, explains the why',
  playful: 'Witty and energetic — fun interactions, always correct',
};

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function handlePersonaCommand(host: SlashCommandHost, args: string): Promise<void> {
  const raw = args.trim();

  if (raw.length === 0) {
    await showPersonaStatus(host);
    return;
  }

  const [subcmd, ...rest] = raw.split(/\s+/);
  const value = rest.join(' ').trim();

  switch (subcmd?.toLowerCase()) {
    case 'list':
    case 'presets':
      showPresetList(host);
      return;

    case 'set':
    case 'preset': {
      if (value.length === 0) {
        host.showError('Usage: /persona set <preset>. Run /persona list to see options.');
        return;
      }
      await applyPreset(host, value.toLowerCase());
      return;
    }

    case 'name': {
      if (value.length === 0) {
        host.showError('Usage: /persona name <display name>');
        return;
      }
      await patchPersona(host, { name: value });
      host.showStatus(`Persona name set to "${value}".`, 'success');
      return;
    }

    case 'tone': {
      if (value.length === 0) {
        host.showError('Usage: /persona tone <description> (e.g. "warm and casual")');
        return;
      }
      await patchPersona(host, { tone: value });
      host.showStatus(`Persona tone set to "${value}".`, 'success');
      return;
    }

    case 'personality': {
      if (value.length === 0) {
        host.showError('Usage: /persona personality <description>');
        return;
      }
      await patchPersona(host, { personality: value });
      host.showStatus(`Persona personality updated.`, 'success');
      return;
    }

    case 'instructions':
    case 'say': {
      if (value.length === 0) {
        host.showError('Usage: /persona instructions <free-form text>');
        return;
      }
      await patchPersona(host, { instructions: value });
      host.showStatus(`Persona custom instructions updated.`, 'success');
      return;
    }

    case 'clear':
    case 'off':
    case 'reset': {
      await clearPersona(host);
      return;
    }

    case 'help': {
      showPersonaHelp(host);
      return;
    }

    default: {
      // Treat bare text as a preset name if it matches, otherwise as free-form instructions.
      if (PRESET_NAMES.includes(subcmd?.toLowerCase() as PresetName)) {
        await applyPreset(host, subcmd!.toLowerCase());
        return;
      }
      host.showError(
        `Unknown persona subcommand: ${subcmd}. Use /persona help for usage.`,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function showPersonaStatus(host: SlashCommandHost): Promise<void> {
  const config = await host.harness.getConfig({ reload: false });
  const persona = config.persona;

  if (persona === undefined || isEmptyPersona(persona)) {
    host.showNotice(
      'Persona',
      'No persona configured. The agent uses its default personality.\n\nUse /persona set <preset> or /persona help to customize.',
    );
    return;
  }

  const lines: string[] = [];
  if (persona.name !== undefined && persona.name.trim().length > 0) lines.push(`Name: ${persona.name}`);
  if (persona.preset !== undefined && persona.preset !== 'none') lines.push(`Preset: ${persona.preset}`);
  if (persona.personality !== undefined && persona.personality.trim().length > 0) lines.push(`Personality: ${persona.personality}`);
  if (persona.tone !== undefined && persona.tone.trim().length > 0) lines.push(`Tone: ${persona.tone}`);
  if (persona.instructions !== undefined && persona.instructions.trim().length > 0) lines.push(`Instructions: ${persona.instructions}`);

  host.showNotice('Persona', lines.join('\n'));
}

function showPresetList(host: SlashCommandHost): void {
  const lines = PRESET_NAMES.map(
    (name) => `  ${name.padEnd(14)} ${PRESET_DESCRIPTIONS[name]}`,
  );
  host.showNotice(
    'Persona Presets',
    `${lines.join('\n')}\n\nApply with: /persona set <name>`,
  );
}

function showPersonaHelp(host: SlashCommandHost): void {
  host.showNotice(
    'Persona Help',
    [
      '/persona                     Show current persona',
      '/persona list                List available presets',
      '/persona set <preset>        Apply a preset (friendly, professional, …)',
      '/persona name <name>         Set a display name for the persona',
      '/persona tone <desc>         Set response tone (e.g. "warm and casual")',
      '/persona personality <desc>  Set personality traits',
      '/persona instructions <text> Add free-form behavioral instructions',
      '/persona clear               Remove all persona customization',
      '',
      'Persona settings persist in ~/.superliora/config.toml [persona].',
      'Changes apply immediately to the active session.',
    ].join('\n'),
  );
}

async function applyPreset(host: SlashCommandHost, presetName: string): Promise<void> {
  if (!PRESET_NAMES.includes(presetName as PresetName)) {
    host.showError(
      `Unknown preset: "${presetName}". Available: ${PRESET_NAMES.join(', ')}.`,
    );
    return;
  }

  await patchPersona(host, { preset: presetName as PresetName });
  host.showStatus(
    `Persona preset "${presetName}" applied. ${PRESET_DESCRIPTIONS[presetName as PresetName]}.`,
    'success',
  );
}

async function clearPersona(host: SlashCommandHost): Promise<void> {
  try {
    // Set all fields to empty/none to clear them.
    await host.harness.setConfig({
      persona: {
        name: '',
        preset: 'none',
        personality: '',
        tone: '',
        instructions: '',
      },
    });
    // Reload the active session so the change takes effect immediately.
    const session = host.session;
    if (session !== undefined) {
      await session.reloadSession();
      await host.reloadCurrentSessionView(session, 'Persona cleared.');
    }
    host.showStatus('Persona cleared. The agent uses its default personality.', 'success');
  } catch (error) {
    host.showError(`Failed to clear persona: ${formatErrorMessage(error)}`);
  }
}

async function patchPersona(host: SlashCommandHost, patch: Partial<PersonaConfig>): Promise<void> {
  try {
    await host.harness.setConfig({ persona: patch });
    // Reload the active session so the new persona takes effect immediately.
    const session = host.session;
    if (session !== undefined) {
      await session.reloadSession();
      await host.reloadCurrentSessionView(session, 'Persona applied.');
    }
  } catch (error) {
    host.showError(`Failed to update persona: ${formatErrorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEmptyPersona(persona: PersonaConfig): boolean {
  return (
    (persona.name === undefined || persona.name.trim().length === 0) &&
    (persona.preset === undefined || persona.preset === 'none') &&
    (persona.personality === undefined || persona.personality.trim().length === 0) &&
    (persona.tone === undefined || persona.tone.trim().length === 0) &&
    (persona.instructions === undefined || persona.instructions.trim().length === 0)
  );
}
