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
import { loadSkillsState } from '#/utils/skills/skills-state';

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
        {
          value: 'tip-search-skill',
          label: 'SearchSkill tip',
          description:
            'Catalog discovery via SearchSkill → Skill · keyword guidance · locale discovery.',
        },
        {
          value: 'tip-risk-filter',
          label: 'Risk filter tip',
          description:
            'metadata.risk=high exclusion · inline/prompt only · disableModelInvocation.',
        },
        {
          value: 'tip-trace-skill',
          label: 'Trace→Skill tip',
          description:
            'Session-end draft suggestions · manual merge · no auto pipeline or PR bot.',
        },
        {
          value: 'tip-manage',
          label: 'Manage skills tip',
          description:
            'Extensions → Skills toggle · Claude import · plugin skills · hot-reload · /skills.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showSkillsSettingsPanel(host);
          return;
        }
        if (value === 'manage') {
          showExtensionsHub(host);
          return;
        }
        if (value === 'tip-search-skill') {
          host.showStatus(SKILLS_SEARCH_SKILL_TIP, 'info');
          return;
        }
        if (value === 'tip-risk-filter') {
          host.showStatus(SKILLS_RISK_FILTER_TIP, 'info');
          return;
        }
        if (value === 'tip-trace-skill') {
          host.showStatus(SKILLS_TRACE_SKILL_TIP, 'info');
          return;
        }
        if (value === 'tip-manage') {
          host.showStatus(SKILLS_MANAGE_TIP, 'info');
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
