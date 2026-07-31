/**
 * Settings → Media fallback — live policy + model vision glance (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { getDataDir } from '#/utils/paths';
import {
  buildMediaSettingsLines,
  loadMediaSettingsGlance,
  resolveMediaConfigPath,
} from '#/tui/utils/media/media-glance';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';

import type { SlashCommandHost } from '../../hub/dispatch';

export function showMediaSettings(host: SlashCommandHost): void {
  void showMediaSettingsPanel(host);
}

async function showMediaSettingsPanel(host: SlashCommandHost): Promise<void> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const configPath = resolveMediaConfigPath({
    homeDir,
    configPath: host.harness.configPath,
  });

  let policy = host.state.appState.nonVisionFallbackPolicy;
  let configError: string | undefined;
  try {
    const config = await host.harness.getConfig({ reload: true });
    policy = config.media?.nonVisionFallback ?? policy ?? 'analyze';
  } catch (error) {
    configError = error instanceof Error ? error.message : String(error);
  }

  const glance = loadMediaSettingsGlance({
    policy,
    model: host.state.appState.model,
    availableModels: host.state.appState.availableModels,
    configPath,
    configError,
  });
  const lines = buildMediaSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Media fallback ',
    enterBeatSeed: 'media-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
