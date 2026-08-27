/**
 * Settings → Extensions hub: Plugins / Skills / MCP (Claude-compatible).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';
import { showClaudeImportPanel } from './claude-import-panel';
import { showMcpManagePanel } from '../mcp/mcp-manage';
import { showSkillsManagePanel } from '../skills/skills-manage';

export function showExtensionsHub(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.extensions.modal.title'),
      hintExtra: ttui('tui.extensions.hub.hint'),
      searchable: true,
      options: [
        {
          value: 'plugins',
          label: ttui('tui.extensions.tab.plugins'),
          description: ttui('tui.extensions.hub.pluginsDesc'),
        },
        {
          value: 'skills',
          label: ttui('tui.extensions.tab.skills'),
          description: ttui('tui.extensions.hub.skillsDesc'),
        },
        {
          value: 'mcp',
          label: ttui('tui.extensions.hub.mcp'),
          description: ttui('tui.extensions.hub.mcpManageDesc'),
        },
        {
          value: 'import-claude',
          label: ttui('tui.extensions.hub.claude'),
          description: ttui('tui.extensions.hub.claudeDesc'),
        },
        {
          value: 'core-waist',
          label: ttui('tui.extensions.hub.coreWaist'),
          description: ttui('tui.extensions.hub.coreWaistDesc'),
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        switch (value) {
          case 'plugins':
            void import('../../plugins/plugins').then(({ handlePluginsCommand }) =>
              handlePluginsCommand(host, ''),
            );
            return;
          case 'skills':
            void showSkillsManagePanel(host);
            return;
          case 'mcp':
            void showMcpManagePanel(host);
            return;
          case 'import-claude':
            void showClaudeImportPanel(host);
            return;
          case 'core-waist':
            void import('../harness/agent-profile').then(({ handleProfileCommand }) =>
              handleProfileCommand(host, 'core'),
            );
            return;
        }
      },
      onCancel: () =>{  dismissPickerDialog(host); },
    }),
    { label: ttui('tui.extensions.modal.title') },
  );
}
