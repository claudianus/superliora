/**
 * Settings → Visual Quality — live motion budget + renderer quality glance (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import {
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import {
  buildPremiumSettingsLines,
  loadPremiumVisualGlance,
} from '#/tui/utils/premium/premium-glance';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { currentAppearance } from './tui-persist';

import type { SlashCommandHost } from '../hub/dispatch';

export function showPremiumSettings(host: SlashCommandHost): void {
  void showPremiumSettingsPanel(host);
}

async function showPremiumSettingsPanel(host: SlashCommandHost): Promise<void> {
  let sessionPremiumQuality: boolean | undefined;
  try {
    const status = await host.requireSession().getStatus();
    if (status.premiumQualityMode !== undefined) {
      sessionPremiumQuality =  status.premiumQualityMode;
    }
  } catch {
    /* panel still renders from appState + renderer */
  }

  const glance = loadPremiumVisualGlance({
    premiumQualityMode: host.state.appState.premiumQualityMode,
    appearance: currentAppearance(host),
    renderQuality: getAppearanceRenderQuality(),
    renderHealth: getAppearanceRenderHealth(),
    diagnostics: host.state.renderer.nativeRuntime?.diagnostics,
    sessionPremiumQuality,
  });
  const lines = buildPremiumSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Visual Quality ',
    enterBeatSeed: 'premium-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
