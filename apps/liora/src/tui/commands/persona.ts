import {
  PERSONA_PRESET_CATALOG,
  PERSONA_PRESET_IDS,
  atomicPersonaConfigForPreset,
  getPersonaPreset,
  isEmptyPersona,
  isPersonaPresetId,
  normalizePersonaPresetId,
  type PersonaConfig,
  type PersonaPresetId,
} from '@superliora/sdk';

import { applyPersonaSkillBundle } from '../utils/persona/apply-skill-bundle';
import { formatErrorMessage } from '../utils/event-payload';
import { isPersonaOptedOut } from '../utils/persona/persona-glance';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './hub/dispatch';

/** Selectable preset ids (excludes `none`). */
export const PERSONA_PRESET_NAMES = PERSONA_PRESET_IDS;

export const PERSONA_PRESET_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  PERSONA_PRESET_CATALOG.map((preset) => [preset.id, preset.description]),
);

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
        host.showError(ttui('tui.persona.usageSet'));
        return;
      }
      await applyPreset(host, value.toLowerCase());
      return;
    }

    case 'name': {
      if (value.length === 0) {
        host.showError(ttui('tui.persona.usageName'));
        return;
      }
      await patchPersona(host, { name: value });
      host.showStatus(ttui('tui.persona.nameSet', { value }), 'success');
      return;
    }

    case 'tone': {
      if (value.length === 0) {
        host.showError(ttui('tui.persona.usageTone'));
        return;
      }
      await patchPersona(host, { tone: value });
      host.showStatus(ttui('tui.persona.toneSet', { value }), 'success');
      return;
    }

    case 'personality': {
      if (value.length === 0) {
        host.showError(ttui('tui.persona.usagePersonality'));
        return;
      }
      await patchPersona(host, { personality: value });
      host.showStatus(ttui('tui.persona.personalityUpdated'), 'success');
      return;
    }

    case 'instructions':
    case 'say': {
      if (value.length === 0) {
        host.showError(ttui('tui.persona.usageInstructions'));
        return;
      }
      await patchPersona(host, { instructions: value });
      host.showStatus(ttui('tui.persona.instructionsUpdated'), 'success');
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
      const normalized = normalizePersonaPresetId(subcmd?.toLowerCase() ?? '');
      if (typeof normalized === 'string' && isPersonaPresetId(normalized) && normalized !== 'none') {
        await applyPreset(host, normalized);
        return;
      }
      host.showError(
        `Unknown persona subcommand: ${subcmd}. Use /persona help for usage.`,
      );
      return;
    }
  }
}

async function showPersonaStatus(host: SlashCommandHost): Promise<void> {
  const config = await host.harness.getConfig({ reload: false });
  const persona = config.persona;

  if (isPersonaOptedOut(persona)) {
    host.showNotice(
      'Persona',
      'Personas are disabled (preset = "none").\n\nUse /persona set <preset> or remove preset = "none" to enable a persona.',
    );
    return;
  }

  if (isEmptyPersona(persona)) {
    host.showNotice(
      'Persona',
      'No persona configured — the default Liora preset is active.\n\nUse /persona set <preset> or /persona help to customize. Set preset = "none" in config.toml to disable personas.',
    );
    return;
  }

  const lines: string[] = [];
  if (persona?.name !== undefined && persona.name.trim().length > 0) {
    lines.push(`Name: ${persona.name}`);
  }
  if (persona?.preset !== undefined && persona.preset !== 'none') {
    const normalized = normalizePersonaPresetId(persona.preset);
    lines.push(`Preset: ${normalized}`);
  }
  if (persona?.personality !== undefined && persona.personality.trim().length > 0) {
    lines.push(`Personality: ${persona.personality}`);
  }
  if (persona?.tone !== undefined && persona.tone.trim().length > 0) {
    lines.push(`Tone: ${persona.tone}`);
  }
  if (persona?.instructions !== undefined && persona.instructions.trim().length > 0) {
    lines.push(`Instructions: ${persona.instructions}`);
  }

  host.showNotice(ttui('tui.persona.title'), lines.join('\n'));
}

function showPresetList(host: SlashCommandHost): void {
  const lines = PERSONA_PRESET_CATALOG.map(
    (preset) => `  ${preset.id.padEnd(14)} ${preset.description}`,
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
      '/persona set <preset>        Apply a preset (atomic — clears custom overrides)',
      '/persona name <name>         Set a display name for the persona',
      '/persona tone <desc>         Override response tone (Advanced)',
      '/persona personality <desc>  Override personality traits (Advanced)',
      '/persona instructions <text> Add free-form behavioral instructions',
      '/persona clear               Remove [persona] (default Liora preset applies)',
      '',
      'Persona settings persist in ~/.superliora/config.toml [persona].',
      'With no [persona] configured, the default Liora preset applies; preset = "none" disables.',
      'Preset skill bundles adjust skills-state.json without wiping other toggles.',
      'Changes apply immediately to the active session.',
    ].join('\n'),
  );
}

export async function applyPreset(host: SlashCommandHost, presetName: string): Promise<void> {
  const normalized = normalizePersonaPresetId(presetName.toLowerCase());
  if (
    typeof normalized !== 'string' ||
    !isPersonaPresetId(normalized) ||
    normalized === 'none'
  ) {
    host.showError(
      `Unknown preset: "${presetName}". Available: ${PERSONA_PRESET_NAMES.join(', ')}.`,
    );
    return;
  }

  const preset = getPersonaPreset(normalized as Exclude<PersonaPresetId, 'none'>);
  try {
    await host.harness.setConfig({
      persona: atomicPersonaConfigForPreset(normalized),
    });
    const skillResult = await applyPersonaSkillBundle(preset?.skillBundle);
    const session = host.session;
    if (session !== undefined) {
      await session.reloadSession();
      await host.reloadCurrentSessionView(session, 'Persona applied.');
      await host.refreshDynamicSlashCommands?.(session);
    }
    const skillNote =
      skillResult.enabled.length > 0
        ? ` Skills enabled: ${skillResult.enabled.join(', ')}.`
        : '';
    host.showStatus(
      `Persona preset "${normalized}" applied. ${preset?.description ?? ''}${skillNote}`,
      'success',
    );
  } catch (error) {
    host.showError(ttui('tui.persona.applyFailed', { message: formatErrorMessage(error) }));
  }
}

async function clearPersona(host: SlashCommandHost): Promise<void> {
  try {
    await host.harness.deleteConfigFields(['persona']);
    const session = host.session;
    if (session !== undefined) {
      await session.reloadSession();
      await host.reloadCurrentSessionView(session, 'Persona cleared.');
    }
    host.showStatus(
      'Persona cleared — the default Liora preset now applies. Skill toggles were left unchanged — manage them under Settings → Skills.',
      'success',
    );
  } catch (error) {
    host.showError(ttui('tui.persona.clearFailed', { message: formatErrorMessage(error) }));
  }
}

export async function patchPersona(
  host: SlashCommandHost,
  patch: Partial<PersonaConfig>,
): Promise<void> {
  try {
    await host.harness.setConfig({ persona: patch });
    const session = host.session;
    if (session !== undefined) {
      await session.reloadSession();
      await host.reloadCurrentSessionView(session, 'Persona applied.');
    }
  } catch (error) {
    host.showError(ttui('tui.persona.updateFailed', { message: formatErrorMessage(error) }));
  }
}
