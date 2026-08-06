import { ChoicePickerComponent } from '../../components/dialogs/picker/choice-picker';
import { SettingsSelectorComponent, type SettingsSelection } from '../../components/dialogs/picker/settings-selector';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import { handleAccountsCommand } from '../auth/accounts';
import { showUsageSettings } from './upgrade/usage-settings';
import { showEditorSettings } from './editor/editor-settings';
import { showUpgradeSettings } from './upgrade/upgrade-settings';
import { showPremiumSettings } from './premium/premium-settings';
import { showPersonaSettings } from './persona/persona-settings';
import type { SlashCommandHost } from '../hub/dispatch';
import {
  showModelPicker,
  showLoopModelRoutingPicker,
  showModelFallbackPicker,
  showModelSettingsReset,
} from './model/model';
import { showContextWorkingSetPicker } from './context/context';
import { showContextSettings } from './context/context-settings';
import { showAppearanceSettings } from './appearance/appearance-settings';
import { showFooterSettings } from './footer/footer-settings';
import { showPermissionPicker } from './permission/permission';
import { showThemeSettings } from './appearance/theme-settings';
import { showMediaSettings } from './media/media-settings';
import { showExperimentsPanel } from './experiments/experiments';
import { showExperimentsSettings } from './experiments/experiments-settings';
import { showToolsInventory } from './harness/harness-tools';
import { handleProfileCommand } from './harness/agent-profile';
import { AGENT_PROFILE_PRESETS } from '#/tui/utils/settings/profile-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { showEyesSettings } from './eyes/eyes-settings';
import { showExtensionsSettings } from './extensions/extensions-settings';
import { showMcpSettings } from './mcp/mcp-settings';
import { showSearchSettings } from './search/search-settings';
import { showProviderExtrasSettings } from './extras/extras-settings';
import { showIndexSettings } from './index/index-settings';
import { showHostSettings } from './host/host-settings';
import { showCacheSettings } from './cache/cache-settings';
import { showNeverHaltSettings } from './never-halt/never-halt-settings';
import { showTelemetrySettings } from './telemetry/telemetry-settings';
import { showHooksSettings } from './hooks/hooks-settings';
import { showSkillsSettings } from './skills/skills-settings';
import { showBenchDiagnosticsSettings } from './diagnostics/bench-diagnostics-settings';
import { showNetworkSettings } from './network/network-settings';
import { showStorageSettings } from './storage/storage-settings';
import { showSecuritySettings } from './security/security-settings';
import { showCompactionSettings } from './context/compaction-settings';
import { showSettingsInventory } from './diagnostics/settings-inventory';
import { showProvidersApiSettings } from './providers/providers-api-settings';
import { showKeybindingsSettings } from './keybindings/keybindings-settings';
import { showMemorySettings } from './memory/memory-settings';

export function showSettingsSelector(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new SettingsSelectorComponent({
      onSelect: (value) => {
        openSettingsPane(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Settings' },
  );
}

/** Open a specific Settings pane (Hub One-search / programmatic). */
export function openSettingsPane(host: SlashCommandHost, value: SettingsSelection): void {
  dismissPickerDialog(host);
  handleSettingsSelection(host, value);
}

function handleSettingsSelection(host: SlashCommandHost, value: SettingsSelection): void {
  dismissPickerDialog(host);
  switch (value) {
    case 'model': showModelPicker(host); return;
    case 'model-routing': void showLoopModelRoutingPicker(host); return;
    case 'model-fallback': void showModelFallbackPicker(host); return;
    case 'model-reset': showModelSettingsReset(host); return;
    case 'permission': showPermissionPicker(host); return;
    case 'providers-api': showProvidersApiSettings(host); return;
    case 'security': showSecuritySettings(host); return;
    case 'accounts': void handleAccountsCommand(host); return;
    case 'keybindings': showKeybindingsSettings(host); return;
    case 'context': showContextSettings(host); return;
    case 'compaction': showCompactionSettings(host); return;
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
    case 'provider-extras': showProviderExtrasSettings(host); return;
    case 'index': showIndexSettings(host); return;
    case 'host': showHostSettings(host); return;
    case 'cache': showCacheSettings(host); return;
    case 'never-halt': showNeverHaltSettings(host); return;
    case 'telemetry': showTelemetrySettings(host); return;
    case 'bench-diagnostics': showBenchDiagnosticsSettings(host); return;
    case 'network': showNetworkSettings(host); return;
    case 'storage':  showStorageSettings(host); return;
    case 'theme': showThemeSettings(host); return;
    case 'appearance': showAppearanceSettings(host); return;
    case 'footer': showFooterSettings(host); return;
    case 'editor': showEditorSettings(host); return;
    case 'experiments': showExperimentsSettings(host); return;
    case 'upgrade': showUpgradeSettings(host); return;
    case 'persona': showPersonaSettings(host); return;
    case 'usage':  showUsageSettings(host); return;
    case 'memory': showMemorySettings(host); return;
  }
}

/**
 * Settings → Harness: eyes/hands surface (tools, eyes, Visual Quality, experiments).
 * Plugins / skills / MCP manage lives under Settings → Extensions (and Hub → Extend).
 */
export function showHarnessPanel(host: SlashCommandHost): void {
  mountPickerDialog(host,
    new ChoicePickerComponent({
      title: 'Harness',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        SETTINGS_PRESETS_ROW,
        {
          value: 'agent-profile',
          label: 'Agent profile',
          description: 'Core waist · agent · superliora-full — same as /profile',
        },
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
          case 'presets':
          case 'agent-profile':
            showSettingPresetsPicker(host, {
              title: 'Agent profile presets',
              catalog: AGENT_PROFILE_PRESETS,
              onApply: async (preset) => {
                await handleProfileCommand(host, preset.patch.profile);
              },
            });
            return;
          case 'tools':
            void showToolsInventory(host);
            return;
          case 'eyes':
            showEyesSettings(host);
            return;
          case 'premium':
            showPremiumSettings(host);
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
