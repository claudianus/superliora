import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { SettingsSelectorComponent, type SettingsSelection } from '../../components/dialogs/picker/settings-selector';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import { handleAccountsCommand } from '../accounts';
import { showMcpServers, showUsage } from '../info';
import { handlePremiumQualityCommand } from '../premium';
import { handlePersonaCommand } from '../persona';
import type { SlashCommandHost } from '../dispatch';
import { showModelPicker, showLoopModelRoutingPicker, showModelFallbackPicker } from './model';
import { showContextWorkingSetPicker } from './context';
import { handleAppearanceCommand } from './appearance';
import { showPermissionPicker } from './permission';
import { showEditorPicker, showThemePicker } from './editor-theme';
import { showMediaFallbackPicker } from './media';
import { showExperimentsPanel } from './experiments';
import { showUpdatePreferencePicker } from './update-preference';
import { showToolsInventory, showHarnessEyesReadiness } from './harness-tools';

export function showSettingsSelector(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new SettingsSelectorComponent({
      onSelect: (value) => {
        handleSettingsSelection(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Settings' },
  );
}

function handleSettingsSelection(host: SlashCommandHost, value: SettingsSelection): void {
  dismissPickerDialog(host);
  switch (value) {
    case 'model': showModelPicker(host); return;
    case 'model-routing': void showLoopModelRoutingPicker(host); return;
    case 'model-fallback': void showModelFallbackPicker(host); return;
    case 'permission': showPermissionPicker(host); return;
    case 'accounts': void handleAccountsCommand(host); return;
    case 'context': void showContextWorkingSetPicker(host); return;
    case 'media': void showMediaFallbackPicker(host); return;
    case 'harness': showHarnessPanel(host); return;
    case 'tools': void showToolsInventory(host); return;
    case 'eyes': void showHarnessEyesReadiness(host); return;
    case 'premium': void handlePremiumQualityCommand(host, ''); return;
    case 'mcp': void showMcpServers(host); return;
    case 'theme': showThemePicker(host); return;
    case 'appearance': void handleAppearanceCommand(host, ''); return;
    case 'editor': showEditorPicker(host); return;
    case 'experiments': void showExperimentsPanel(host); return;
    case 'upgrade': showUpdatePreferencePicker(host); return;
    case 'persona': void handlePersonaCommand(host, ''); return;
    case 'usage': void showUsage(host); return;
  }
}

/**
 * Settings → Harness: hub for previously buried eyes/hands controls
 * (tools inventory, premium, MCP, experiments).
 */
export function showHarnessPanel(host: SlashCommandHost): void {
  mountPickerDialog(host,
    new ChoicePickerComponent({
      title: 'Harness',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'tools',
          label: 'Tools inventory',
          description: 'List active agent tools (SearchTools surface).',
        },
        {
          value: 'eyes',
          label: 'Eyes readiness',
          description: 'Browser-use / computer-use runtime status.',
        },
        {
          value: 'premium',
          label: 'Premium Quality',
          description: 'Toggle visual-first premium harness.',
        },
        {
          value: 'mcp',
          label: 'MCP servers',
          description: 'Model Context Protocol server status.',
        },
        {
          value: 'experiments',
          label: 'Experiments',
          description: 'Feature flags (micro compaction, codegraph, …).',
        },
        {
          value: 'context',
          label: 'Context working set',
          description: 'Auto-compaction / working-set presets.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        switch (value) {
          case 'tools':
            void showToolsInventory(host);
            return;
          case 'eyes':
            void showHarnessEyesReadiness(host);
            return;
          case 'premium':
            void handlePremiumQualityCommand(host, '');
            return;
          case 'mcp':
            void showMcpServers(host);
            return;
          case 'experiments':
            void showExperimentsPanel(host);
            return;
          case 'context':
            void showContextWorkingSetPicker(host);
            return;
          default:
            return;
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}
