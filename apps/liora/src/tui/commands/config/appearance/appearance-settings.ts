/**
 * Settings → Appearance — live theme engine + saved motion prefs (SSOT §9.2).
 * Read-only glance + tips; persist via /appearance and Settings → Theme.
 */

import { currentTheme } from '#/tui/theme';
import {
  APPEARANCE_BACKGROUND_TIP,
  APPEARANCE_CHANGE_TIP,
  APPEARANCE_MOTION_TIP,
  APPEARANCE_THEME_TIP,
  buildAppearanceSettingsLines,
  loadAppearanceSettingsGlance,
} from '#/tui/utils/appearance/appearance-glance';
import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { currentAppearance } from './tui-persist';

import type { SlashCommandHost } from '../../hub/dispatch';

export { APPEARANCE_BACKGROUND_TIP, APPEARANCE_CHANGE_TIP, APPEARANCE_MOTION_TIP, APPEARANCE_THEME_TIP };

export function showAppearanceSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Appearance',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Appearance status',
          description:
            'Live theme palette · saved motion prefs · canvas and terminal background (read-only).',
        },
        {
          value: 'tip-theme',
          label: 'Theme tip',
          description:
            'Saved theme name vs live palette · auto tracks terminal · Settings → Theme.',
        },
        {
          value: 'tip-motion',
          label: 'Motion prefs tip',
          description:
            'profile · particles · animation-fps · density · timestamps · /appearance.',
        },
        {
          value: 'tip-background',
          label: 'Background tip',
          description:
            'canvas-background · terminal-background · terminal-palette · transcript-detail.',
        },
        {
          value: 'tip-change',
          label: 'Change / persist tip',
          description:
            '/appearance persists tui.toml · Theme picker · Visual Quality for PQ toggle.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          showAppearanceSettingsPanel(host);
          return;
        }
        if (value === 'tip-theme') {
          host.showStatus(APPEARANCE_THEME_TIP, 'info');
          return;
        }
        if (value === 'tip-motion') {
          host.showStatus(APPEARANCE_MOTION_TIP, 'info');
          return;
        }
        if (value === 'tip-background') {
          host.showStatus(APPEARANCE_BACKGROUND_TIP, 'info');
          return;
        }
        if (value === 'tip-change') {
          host.showStatus(APPEARANCE_CHANGE_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Appearance' },
  );
}

function showAppearanceSettingsPanel(host: SlashCommandHost): void {
  const glance = loadAppearanceSettingsGlance({
    savedTheme: host.state.appState.theme,
    palette: currentTheme.palette,
    canvasBackgroundEnabled: currentTheme.canvasBackgroundEnabled,
    appearance: currentAppearance(host),
  });
  const lines = buildAppearanceSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Appearance ',
    enterBeatSeed: 'appearance-settings',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
