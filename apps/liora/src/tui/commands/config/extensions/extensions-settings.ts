/**
 * Settings → Extensions — live session counts + manage hub (SSOT §9.2 / §19).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildExtensionsSettingsLines,
  type ExtensionsSessionLiveGlance,
} from '../../../utils/agent/extensions-glance';
import { formatErrorMessage } from '../../../utils/event-payload';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { loadSkillsState } from '#/utils/skills/skills-state';

import type { SlashCommandHost } from '../../hub/dispatch';
import { showExtensionsHub } from './extensions-hub';

async function loadExtensionsSessionLiveGlance(
  host: SlashCommandHost,
): Promise<ExtensionsSessionLiveGlance> {
  try {
    const session = host.requireSession();
    const [plugins, skills, mcpServers, skillsState] = await Promise.all([
      session.listPlugins(),
      session.listSkills(),
      session.listMcpServers(),
      loadSkillsState(),
    ]);
    return {
      plugins,
      skills,
      mcpServers,
      skillsDisabled: skillsState.disabled,
    };
  } catch (error) {
    const message = formatErrorMessage(error);
    if (/session/i.test(message)) {
      return { sessionUnavailable: true };
    }
    return { loadError: message };
  }
}

export function showExtensionsSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Extensions',
      hint: '↑↓ · Enter · Esc · install/toggle hot-reloads session',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Live status',
          description: 'Installed plugins, skills, MCP counts from this session.',
        },
        {
          value: 'manage',
          label: 'Manage extensions',
          description: 'Plugins, skills, MCP, Claude import, core waist.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showExtensionsStatusPanel(host);
          return;
        }
        showExtensionsHub(host);
      },
      onCancel: () =>{  dismissPickerDialog(host); },
    }),
    { label: 'Extensions' },
  );
}

async function showExtensionsStatusPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadExtensionsSessionLiveGlance(host);
  const lines = buildExtensionsSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Extensions ',
    enterBeatSeed: 'extensions-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
