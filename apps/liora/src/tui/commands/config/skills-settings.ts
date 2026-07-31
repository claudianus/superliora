/**
 * Settings → Skills — read-only catalog + SearchSkill tips (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildSkillsSettingsLines,
  summarizeSkillsCatalog,
} from '../../utils/skills/skills-glance';
import { getDataDir } from '#/utils/paths';
import { loadSkillsState } from '#/utils/skills/skills-state';

import type { SlashCommandHost } from '../hub/dispatch';

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
  void showSkillsSettingsPanel(host);
}

async function showSkillsSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadSkillsGlance(host);
  const lines = buildSkillsSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Skills ',
    enterBeatSeed: 'skills-settings',
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
