/**
 * Settings → Persona — preset picker, Advanced editors, glance.
 */

import {
  DEFAULT_PERSONA_PRESET_ID,
  PERSONA_PRESET_CATALOG,
  normalizePersonaPresetId,
  resolveConfigPath,
} from '@superliora/sdk';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { PlainTextInputDialogComponent } from '../../../components/dialogs/shared/plain-text-input-dialog';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildPersonaSettingsLines,
  PERSONA_CUSTOMIZE_TIP,
  PERSONA_PERSIST_TIP,
  PERSONA_PRESET_TIP,
  type PersonaGlanceInput,
} from '#/tui/utils/persona/persona-glance';
import { getDataDir } from '#/utils/paths';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import {
  applyPreset,
  handlePersonaCommand,
  patchPersona,
} from '../../persona';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { PERSONA_CUSTOMIZE_TIP, PERSONA_PERSIST_TIP, PERSONA_PRESET_TIP };

async function loadPersonaGlance(host: SlashCommandHost): Promise<PersonaGlanceInput> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });

  try {
    const config = await host.harness.getConfig({ reload: true });
    return {
      persona: config.persona,
      configPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { configPath, configError: message };
  }
}

export function showPersonaSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.persona.title'),
      hint: '↑↓←→ · Enter · Esc',
      searchable: true,
      layout: 'grid',
      options: [
        {
          value: 'status',
          label: 'Persona status',
          description: 'Active name · preset · tone · config path.',
        },
        {
          value: 'preset',
          label: 'Presets…',
          description: PERSONA_PRESET_TIP,
        },
        {
          value: 'name',
          label: 'Display name…',
          description: 'Label in the persona prompt header.',
        },
        {
          value: 'tone',
          label: 'Tone override…',
          description: PERSONA_CUSTOMIZE_TIP,
        },
        {
          value: 'personality',
          label: 'Personality override…',
          description: 'Replaces preset personality line when set.',
        },
        {
          value: 'instructions',
          label: 'Custom instructions…',
          description: 'Extra behavioral rules appended to the persona block.',
        },
        {
          value: 'clear',
          label: 'Clear persona',
          description: 'Delete [persona] — default Liora preset applies; skills unchanged.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showPersonaSettingsPanel(host);
          return;
        }
        if (value === 'preset') {
          void showPersonaPresetPicker(host);
          return;
        }
        if (value === 'name' || value === 'tone' || value === 'personality' || value === 'instructions') {
          void showPersonaFieldEditor(host, value);
          return;
        }
        if (value === 'clear') {
          void handlePersonaCommand(host, 'clear');
          return;
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.persona.title') },
  );
}

async function showPersonaPresetPicker(host: SlashCommandHost): Promise<void> {
  let current: string | undefined = DEFAULT_PERSONA_PRESET_ID;
  try {
    const config = await host.harness.getConfig({ reload: false });
    const preset = config.persona?.preset;
    if (typeof preset === 'string') {
      const normalized = normalizePersonaPresetId(preset);
      current = normalized === 'none' ? undefined : String(normalized);
    }
  } catch {
    /* picker still works without live config */
  }

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.persona.presets'),
      hint: '↑↓←→ · Enter · Esc',
      searchable: true,
      layout: 'grid',
      currentValue: current,
      options: PERSONA_PRESET_CATALOG.map((preset) => {
        const skills = preset.skillBundle?.enableSkills?.join(', ');
        const skillBadge = skills !== undefined && skills.length > 0 ? ` · skills: ${skills}` : '';
        return {
          value: preset.id,
          label: preset.label,
          description: `${preset.description}${skillBadge}`,
        };
      }),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyPreset(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.persona.presets') },
  );
}

async function showPersonaFieldEditor(
  host: SlashCommandHost,
  field: 'name' | 'tone' | 'personality' | 'instructions',
): Promise<void> {
  let initial = '';
  try {
    const config = await host.harness.getConfig({ reload: false });
    const persona = config.persona;
    initial = (persona?.[field] ?? '').toString();
  } catch {
    /* empty initial */
  }

  const titleKeys: Record<typeof field, string> = {
    name: 'tui.settings.pane.persona.displayName',
    tone: 'tui.settings.pane.persona.toneOverride',
    personality: 'tui.settings.pane.persona.personalityOverride',
    instructions: 'tui.settings.pane.persona.customInstructions',
  };
  const title = ttui(titleKeys[field]);

  mountPickerDialog(
    host,
    new PlainTextInputDialogComponent({
      title,
      prefill: initial,
      allowEmpty: true,
      onDone: (result) => {
        dismissPickerDialog(host);
        if (result.kind !== 'ok') return;
        void patchPersona(host, { [field]: result.value }).then(() => {
          host.showStatus(ttui('tui.persona.fieldUpdated', { field }), 'success');
        });
      },
    }),
    { label: title },
  );
}

async function showPersonaSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadPersonaGlance(host);
  const lines = buildPersonaSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.persona.panelTitle'),
    enterBeatSeed: 'persona-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
