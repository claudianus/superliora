/**
 * Settings → Extensions hub: Plugins / Skills / MCP (Claude-compatible).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { showClaudeImportPanel } from './claude-import-panel';
import { showMcpManagePanel } from '../mcp/mcp-manage';
import { showSkillsManagePanel } from '../skills/skills-manage';

export function showExtensionsHub(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Extensions',
      hint: '↑↓ · Enter · Esc · install/toggle hot-reloads session',
      searchable: true,
      options: [
        {
          value: 'plugins',
          label: 'Plugins',
          description: 'Install, enable, disable, remove, marketplace.',
        },
        {
          value: 'skills',
          label: 'Skills',
          description: 'Enable/disable skills for slash activation.',
        },
        {
          value: 'mcp',
          label: 'MCP servers',
          description: 'Install, toggle, remove, reload (mcp.json).',
        },
        {
          value: 'import-claude',
          label: 'Import from Claude Code',
          description: 'Skills + MCP from ~/.claude; plugins via .claude-plugin/plugin.json.',
        },
        {
          value: 'core-waist',
          label: 'Core waist (≤12 tools)',
          description: 'Mission/Fleet surface — /profile core, then /new.',
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
    { label: 'Extensions' },
  );
}
