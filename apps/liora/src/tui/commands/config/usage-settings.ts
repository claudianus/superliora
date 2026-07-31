/**
 * Settings → Usage — live token/$ glance from getStatus (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { formatErrorMessage } from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildUsageSettingsLines,
  loadUsageSettingsGlance,
} from '#/tui/utils/usage/usage-settings-glance';

import type { SlashCommandHost } from '../hub/dispatch';

export function showUsageSettings(host: SlashCommandHost): void {
  void showUsageSettingsPanel(host);
}

async function showUsageSettingsPanel(host: SlashCommandHost): Promise<void> {
  let glance = loadUsageSettingsGlance({
    sessionCostUsd: host.state.appState.sessionCostUsd,
    contextUsage: host.state.appState.contextUsage,
    contextTokens: host.state.appState.contextTokens,
    maxContextTokens: host.state.appState.maxContextTokens,
  });

  try {
    const status = await host.requireSession().getStatus();
    glance = loadUsageSettingsGlance({
      status,
      sessionCostUsd: host.state.appState.sessionCostUsd,
      contextUsage: host.state.appState.contextUsage,
      contextTokens: host.state.appState.contextTokens,
      maxContextTokens: host.state.appState.maxContextTokens,
    });
  } catch (error) {
    glance = loadUsageSettingsGlance({
      sessionCostUsd: host.state.appState.sessionCostUsd,
      contextUsage: host.state.appState.contextUsage,
      contextTokens: host.state.appState.contextTokens,
      maxContextTokens: host.state.appState.maxContextTokens,
      sessionError: formatErrorMessage(error),
    });
  }

  const lines = buildUsageSettingsLines(glance);
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Usage ',
    enterBeatSeed: 'usage-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
