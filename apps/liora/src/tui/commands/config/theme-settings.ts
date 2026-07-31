/**
 * Settings → Theme — live palette + catalog glance (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import {
  buildThemeSettingsLines,
  loadThemeSettingsGlance,
} from '#/tui/utils/theme/theme-glance';
import { requestTUILayoutRender } from '../../utils/render/frame-render';

import type { SlashCommandHost } from '../hub/dispatch';

export function showThemeSettings(host: SlashCommandHost): void {
  const glance = loadThemeSettingsGlance({
    savedTheme: host.state.appState.theme,
    palette: currentTheme.palette,
    canvasBackgroundEnabled: currentTheme.canvasBackgroundEnabled,
  });
  const lines = buildThemeSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Theme ',
    enterBeatSeed: 'theme-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
