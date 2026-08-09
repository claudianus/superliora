/**
 * Settings → Theme — live palette + catalog glance (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import {
  buildThemeSettingsLines,
  loadThemeSettingsGlance,
  THEME_APPEARANCE_TIP,
  THEME_CUSTOM_TIP,
  THEME_IMPORT_TIP,
} from '#/tui/utils/theme/theme-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { showThemePicker } from './editor-theme';
import { ttui } from '../../../utils/tui-i18n';

export { THEME_APPEARANCE_TIP, THEME_CUSTOM_TIP, THEME_IMPORT_TIP };

export function showThemeSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.theme.title'),
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Theme status',
          description:
            'Saved theme · live palette · canvas background · catalog counts · config path.',
        },
        {
          value: 'change-theme',
          label: 'Change theme',
          description: 'Searchable picker with preview — bundled, custom, plugin, and external.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showThemeSettingsPanel(host);
          return;
        }
        if (value === 'change-theme') {
          showThemePicker(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.theme.title') },
  );
}

function showThemeSettingsPanel(host: SlashCommandHost): void {
  const glance = loadThemeSettingsGlance({
    savedTheme: host.state.appState.theme,
    palette: currentTheme.palette,
    canvasBackgroundEnabled: currentTheme.canvasBackgroundEnabled,
  });
  const lines = buildThemeSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.theme.panelTitle'),
    enterBeatSeed: 'theme-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
