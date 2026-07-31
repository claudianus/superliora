import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { SettingsSelectorComponent, type SettingsSelection } from '../../components/dialogs/picker/settings-selector';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import { handleAccountsCommand } from '../auth/accounts';
import { showUsageSettings } from './usage-settings';
import { showEditorSettings } from './editor-settings';
import { showUpgradeSettings } from './upgrade-settings';
import { showPremiumSettings } from './premium-settings';
import { showPersonaSettings } from './persona-settings';
import type { SlashCommandHost } from '../hub/dispatch';
import { showModelPicker, showLoopModelRoutingPicker, showModelFallbackPicker } from './model';
import { showContextWorkingSetPicker } from './context';
import { showContextSettings } from './context-settings';
import { showAppearanceSettings } from './appearance-settings';
import { showPermissionPicker } from './permission';
import { showThemeSettings } from './theme-settings';
import { showMediaSettings } from './media-settings';
import { showExperimentsPanel } from './experiments';
import { showExperimentsSettings } from './experiments-settings';
import { showToolsInventory } from './harness-tools';
import { showEyesSettings } from './eyes-settings';
import { showExtensionsHub } from './extensions-hub';
import { showExtensionsSettings } from './extensions-settings';
import { showMcpManagePanel } from './mcp-manage';
import { showMcpSettings } from './mcp-settings';
import { showSearchSettings } from './search-settings';
import { showIndexSettings } from './index-settings';
import { showHostSettings } from './host-settings';
import { showCacheSettings } from './cache-settings';
import { showNeverHaltSettings } from './never-halt-settings';
import { showTelemetrySettings } from './telemetry-settings';
import { showHooksSettings } from './hooks-settings';
import { showSkillsSettings } from './skills-settings';
import { showBenchDiagnosticsSettings } from './bench-diagnostics-settings';
import { showNetworkSettings } from './network-settings';
import { showStorageSettings } from './storage-settings';
import { showSecuritySettings } from './security-settings';
import { showCompactionSettings } from './compaction-settings';
import { showMissionSettings } from './mission-settings';
import { showFleetSettings } from './fleet-settings';
import { showSettingsInventory } from './settings-inventory';
import { showProvidersApiSettings } from './providers-api-settings';
import { showKeybindingsSettings } from './keybindings-settings';

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
    case 'providers-api': showProvidersApiSettings(host); return;
    case 'security': void showSecuritySettings(host); return;
    case 'accounts': void handleAccountsCommand(host); return;
    case 'keybindings': showKeybindingsSettings(host); return;
    case 'context': showContextSettings(host); return;
    case 'compaction': showCompactionSettings(host); return;
    case 'mission': showMissionSettings(host); return;
    case 'fleet': showFleetSettings(host); return;
    case 'media': showMediaSettings(host); return;
    case 'harness': showHarnessPanel(host); return;
    case 'tools': void showToolsInventory(host); return;
    case 'eyes': showEyesSettings(host); return;
    case 'premium': showPremiumSettings(host); return;
    case 'mcp': showMcpSettings(host); return;
    case 'extensions': showExtensionsSettings(host); return;
    case 'hooks':  showHooksSettings(host); return;
    case 'skills':  showSkillsSettings(host); return;
    case 'search': showSearchSettings(host); return;
    case 'index': showIndexSettings(host); return;
    case 'host': showHostSettings(host); return;
    case 'cache': void showCacheSettings(host); return;
    case 'never-halt': void showNeverHaltSettings(host); return;
    case 'telemetry': showTelemetrySettings(host); return;
    case 'bench-diagnostics': showBenchDiagnosticsSettings(host); return;
    case 'network': showNetworkSettings(host); return;
    case 'storage':  showStorageSettings(host); return;
    case 'theme': showThemeSettings(host); return;
    case 'appearance': showAppearanceSettings(host); return;
    case 'editor': showEditorSettings(host); return;
    case 'experiments': showExperimentsSettings(host); return;
    case 'upgrade': showUpgradeSettings(host); return;
    case 'persona': showPersonaSettings(host); return;
    case 'usage':  showUsageSettings(host); return;
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
          description:
            'Active tools · Core≤12 waist (ApplyPatch+RepoQuery) · DeepResearch: agent/full · /profile core',
        },
        {
          value: 'eyes',
          label: 'Eyes readiness',
          description: 'Browser-use / computer-use runtime status.',
        },
        {
          value: 'premium',
          label: 'Visual Quality',
          description: 'Toggle Visual Quality mode (motion, density, anti-slop).',
        },
        {
          value: 'mcp',
          label: 'MCP servers',
          description: 'Install, toggle, remove, reload MCP.',
        },
        {
          value: 'extensions',
          label: 'Extensions',
          description: 'Plugins, skills, MCP control plane.',
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
        {
          value: 'settings-audit',
          label: 'Settings inventory',
          description: 'Audit aid: list all Settings → entries (SSOT §9).',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        switch (value) {
          case 'tools':
            void showToolsInventory(host);
            return;
          case 'eyes':
            showEyesSettings(host);
            return;
          case 'premium':
            showPremiumSettings(host);
            return;
          case 'mcp':
            void showMcpManagePanel(host);
            return;
          case 'extensions':
            showExtensionsHub(host);
            return;
          case 'experiments':
            void showExperimentsPanel(host);
            return;
          case 'context':
            void showContextWorkingSetPicker(host);
            return;
          case 'settings-audit':
            showSettingsInventory(host);
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
