/**
 * Settings → Persona — live preset picker + glance (SSOT §9.2).
 */

import { resolveConfigPath } from '@superliora/sdk';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
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
  handlePersonaCommand,
  PERSONA_PRESET_DESCRIPTIONS,
  PERSONA_PRESET_NAMES,
} from '../../persona';

import type { SlashCommandHost } from '../../hub/dispatch';

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
      title: 'Persona',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Persona status',
          description: 'Active name · preset · tone · personality · config path.',
        },
        {
          value: 'preset',
          label: 'Choose preset…',
          description: 'friendly · professional · concise · creative · mentor · playful.',
        },
        {
          value: 'clear',
          label: 'Clear persona',
          description: 'Remove all persona customization (default personality).',
        },
        {
          value: 'tip-preset',
          label: 'Preset tip',
          description: PERSONA_PRESET_TIP,
        },
        {
          value: 'tip-customize',
          label: 'Customize tip',
          description: PERSONA_CUSTOMIZE_TIP,
        },
        {
          value: 'tip-persist',
          label: 'Persist tip',
          description: PERSONA_PERSIST_TIP,
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
        if (value === 'clear') {
          void handlePersonaCommand(host, 'clear');
          return;
        }
        if (value === 'tip-preset') {
          host.showStatus(PERSONA_PRESET_TIP, 'info');
          return;
        }
        if (value === 'tip-customize') {
          host.showStatus(PERSONA_CUSTOMIZE_TIP, 'info');
          return;
        }
        if (value === 'tip-persist') {
          host.showStatus(PERSONA_PERSIST_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Persona' },
  );
}

async function showPersonaPresetPicker(host: SlashCommandHost): Promise<void> {
  let current: string | undefined;
  try {
    const config = await host.harness.getConfig({ reload: false });
    const preset = config.persona?.preset;
    if (typeof preset === 'string' && preset !== 'none') current = preset;
  } catch {
    /* picker still works without live config */
  }

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Persona preset',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      currentValue: current,
      options: PERSONA_PRESET_NAMES.map((name) => ({
        value: name,
        label: name,
        description: PERSONA_PRESET_DESCRIPTIONS[name],
      })),
      onSelect: (value) => {
        dismissPickerDialog(host);
        void handlePersonaCommand(host, `set ${value}`);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Persona preset' },
  );
}

async function showPersonaSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadPersonaGlance(host);
  const lines = buildPersonaSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Persona ',
    enterBeatSeed: 'persona-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
