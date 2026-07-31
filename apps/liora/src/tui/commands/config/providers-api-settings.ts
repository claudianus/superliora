/**
 * Settings → Providers & API — read-only /login + env tips (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildProvidersApiSettingsLines,
  loadProvidersApiGlance,
  resolveProvidersApiSessionGlance,
} from '../../utils/provider/providers-api-glance';

import type { SlashCommandHost } from '../hub/dispatch';

async function loadProvidersSessionGlance(host: SlashCommandHost) {
  const glance = loadProvidersApiGlance(process.env);
  const appState = host.state.appState;
  const catalogModels = Object.keys(appState.availableModels).length;
  const catalogProviders = Object.keys(appState.availableProviders ?? {}).length;

  let session = resolveProvidersApiSessionGlance({
    appStateModel: appState.model,
    availableModels: appState.availableModels,
    catalogModels,
    catalogProviders,
  });
  let webSearchActive: boolean | undefined;

  try {
    const live = host.requireSession();
    const [status, tools] = await Promise.all([
      live.getStatus(),
      typeof live.getTools === 'function' ? live.getTools() : Promise.resolve([]),
    ]);

    session = resolveProvidersApiSessionGlance({
      statusModel: status.model,
      appStateModel: appState.model,
      availableModels: appState.availableModels,
      providerRouteStatus: status.providerRouteStatus,
      catalogModels,
      catalogProviders,
    });
    webSearchActive = tools.some((tool) => tool.name === 'WebSearch' && tool.active);
  } catch {
    session = resolveProvidersApiSessionGlance({
      appStateModel: appState.model,
      availableModels: appState.availableModels,
      catalogModels,
      catalogProviders,
      sessionUnavailable: true,
    });
  }

  return { ...glance, webSearchActive, session };
}

export function showProvidersApiSettings(host: SlashCommandHost): void {
  void showProvidersApiSettingsPanel(host);
}

async function showProvidersApiSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadProvidersSessionGlance(host);
  const lines = buildProvidersApiSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Providers ',
    enterBeatSeed: 'providers-api',
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
