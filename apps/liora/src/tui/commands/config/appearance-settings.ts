/**
 * Settings → Appearance — live theme engine + saved motion prefs (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import {
  buildAppearanceSettingsLines,
  loadAppearanceSettingsGlance,
} from '#/tui/utils/appearance/appearance-glance';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { currentAppearance } from './tui-persist';

import type { SlashCommandHost } from '../hub/dispatch';

export function showAppearanceSettings(host: SlashCommandHost): void {
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
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
