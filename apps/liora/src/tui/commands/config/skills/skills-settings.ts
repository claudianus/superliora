/**
 * Settings → Skills — catalog glance + Extensions manage entry (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildSkillsSettingsLines,
  SKILLS_MANAGE_TIP,
  SKILLS_RISK_FILTER_TIP,
  SKILLS_SEARCH_SKILL_TIP,
  SKILLS_TRACE_SKILL_TIP,
  summarizeSkillsCatalog,
} from '../../../utils/skills/skills-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { getDataDir } from '#/utils/paths';
import { loadSkillsState, saveSkillsState } from '#/utils/skills/skills-state';
import { SKILLS_PRESETS } from '#/tui/utils/settings/skills-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { formatErrorMessage } from '#/tui/utils/event-payload';

import type { SlashCommandHost } from '../../hub/dispatch';

import { showExtensionsHub } from '../extensions/extensions-hub';

export { SKILLS_MANAGE_TIP, SKILLS_RISK_FILTER_TIP, SKILLS_SEARCH_SKILL_TIP, SKILLS_TRACE_SKILL_TIP };

async function loadSkillsGlance(host: SlashCommandHost): Promise<{
  readonly homeDir: string;
  readonly catalog?: ReturnType<typeof summarizeSkillsCatalog>;
  readonly searchSkillActive?: boolean;
}> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const state = await loadSkillsState();

  try {
    const session = host.requireSession();
    const [skills, tools] = await Promise.all([
      session.listSkills(),
      typeof session.getTools === 'function' ? session.getTools() : Promise.resolve([]),
    ]);
    const searchSkillActive = tools.some((tool) => tool.name === 'SearchSkill' && tool.active);
    return {
      homeDir,
      catalog: summarizeSkillsCatalog(skills, state.disabled),
      searchSkillActive,
    };
  } catch {
    return { homeDir };
  }
}

export function showSkillsSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Skills',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        SETTINGS_PRESETS_ROW,
        {
          value: 'status',
          label: 'Skills status',
          description:
            'Live catalog counts · SearchSkill active/inactive · source breakdown · home skills dir.',
        },
        {
          value: 'manage',
          label: 'Manage skills',
          description: 'Opens Extensions hub → Skills (canonical manage surface).',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'presets') {
          showSettingPresetsPicker(host, {
            title: 'Skills presets',
            catalog: SKILLS_PRESETS,
            onApply: async (preset) => {
              try {
                const state = await loadSkillsState();
                const next = new Set(state.disabled);
                for (const name of preset.patch.enable) next.delete(name);
                for (const name of preset.patch.disable) next.add(name);
                await saveSkillsState({ disabled: [...next] });
                await host.refreshDynamicSlashCommands?.(host.session);
                host.showStatus(`Skills preset "${preset.label}" applied.`, 'success');
              } catch (error) {
                host.showError(`Failed to apply skills preset: ${formatErrorMessage(error)}`);
              }
            },
          });
          return;
        }
        if (value === 'status') {
          void showSkillsSettingsPanel(host);
          return;
        }
        if (value === 'manage') {
          showExtensionsHub(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Skills' },
  );
}

async function showSkillsSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadSkillsGlance(host);
  const lines = buildSkillsSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Skills ',
    enterBeatSeed: 'skills-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
