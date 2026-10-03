import { SettingsSelectorComponent, type SettingsSelection } from '../../components/dialogs/picker/settings-selector';
import { dismissPickerDialog, mountPickerDialog } from '../../utils/ui/mount-picker';
import type { SlashCommandHost } from '../hub/dispatch';
import { ttui } from '#/tui/utils/tui-i18n';
import { showModelPicker, showModelFallbackPicker, showModelSettingsReset } from './model/model';
import { showPermissionPicker } from './permission/permission';
import { showProvidersApiSettings } from './providers/providers-api-settings';
import { showSecuritySettings } from './security/security-settings';
import { handleAccountsCommand } from '../auth/accounts';
import { showKeybindingsSettings } from './keybindings/keybindings-settings';
import { showHostSettings } from './host/host-settings';
import { showCacheSettings } from './cache/cache-settings';
import { showTelemetrySettings } from './telemetry/telemetry-settings';
import { showNetworkSettings } from './network/network-settings';
import { showStorageSettings } from './storage/storage-settings';
import { showThemeSettings } from './appearance/theme-settings';
import { showAppearanceSettings } from './appearance/appearance-settings';
import { showFooterSettings } from './footer/footer-settings';
import { showEditorSettings } from './editor/editor-settings';
import { showUpgradeSettings } from './upgrade/upgrade-settings';
import { showUsageSettings } from './upgrade/usage-settings';
import { showLocaleSettings } from './locale/locale';
import { showExecutionLimitsSettings } from './limits';

export function showSettingsSelector(host: SlashCommandHost): void {
  mountPickerDialog(host, new SettingsSelectorComponent({
    onSelect: (value) => {
      openSettingsPane(host, value);
    },
    onCancel: () => {
      dismissPickerDialog(host);
    },
  }), { label: ttui('tui.settings.title') });
}

/** Open a specific Settings pane from the Command Hub. */
export function openSettingsPane(host: SlashCommandHost, value: SettingsSelection): void {
  dismissPickerDialog(host);
  switch (value) {
    case 'model': showModelPicker(host); return;
    case 'model-fallback': void showModelFallbackPicker(host); return;
    case 'model-reset': showModelSettingsReset(host); return;
    case 'permission': showPermissionPicker(host); return;
    case 'providers-api': showProvidersApiSettings(host); return;
    case 'security': showSecuritySettings(host); return;
    case 'accounts': void handleAccountsCommand(host); return;
    case 'keybindings': showKeybindingsSettings(host); return;
    case 'host': showHostSettings(host); return;
    case 'cache': showCacheSettings(host); return;
    case 'telemetry': showTelemetrySettings(host); return;
    case 'network': showNetworkSettings(host); return;
    case 'storage': showStorageSettings(host); return;
    case 'theme': showThemeSettings(host); return;
    case 'appearance': showAppearanceSettings(host); return;
    case 'footer': showFooterSettings(host); return;
    case 'editor': showEditorSettings(host); return;
    case 'upgrade': showUpgradeSettings(host); return;
    case 'usage': showUsageSettings(host); return;
    case 'locale': showLocaleSettings(host); return;
    case 'limits': void showExecutionLimitsSettings(host); return;
  }
}
