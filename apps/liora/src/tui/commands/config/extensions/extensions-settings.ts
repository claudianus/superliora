/**
 * Settings → Extensions — live session counts + manage hub (SSOT §9.2 / §19).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import {
  buildExtensionsSettingsLines,
  EXTENSIONS_AUDIT_TIP,
  EXTENSIONS_HOT_RELOAD_TIP,
  EXTENSIONS_MANAGE_TIP,
  type ExtensionsSessionLiveGlance,
} from '../../../utils/agent/extensions-glance';
import { formatErrorMessage } from '../../../utils/event-payload';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { loadSkillsState } from '#/utils/skills/skills-state';

import type { SlashCommandHost } from '../../hub/dispatch';
import { showExtensionsHub } from './extensions-hub';

export { EXTENSIONS_AUDIT_TIP, EXTENSIONS_HOT_RELOAD_TIP, EXTENSIONS_MANAGE_TIP };

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
          label: 'Extensions status',
          description:
            'Live plugins, skills, MCP, and hook counts from this session.',
        },
        {
          value: 'manage',
          label: 'Manage extensions',
          description: 'Plugins, skills, MCP, Claude import, core waist.',
        },
        {
          value: 'tip-audit',
          label: 'Audit surfaces tip',
          description: '/extensions modal · Settings glances · footer ext↻ badge.',
        },
        {
          value: 'tip-manage',
          label: 'Manage paths tip',
          description: '/plugins /skills /mcp · marketplace · Claude import.',
        },
        {
          value: 'tip-hot-reload',
          label: 'Hot-reload tip',
          description: 'Session reload after install/toggle · Never-Halt + ext↻ recovery.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showExtensionsStatusPanel(host);
          return;
        }
        if (value === 'manage') {
          showExtensionsHub(host);
          return;
        }
        if (value === 'tip-audit') {
          host.showStatus(EXTENSIONS_AUDIT_TIP, 'info');
          return;
        }
        if (value === 'tip-manage') {
          host.showStatus(EXTENSIONS_MANAGE_TIP, 'info');
          return;
        }
        if (value === 'tip-hot-reload') {
          host.showStatus(EXTENSIONS_HOT_RELOAD_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
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
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
