/**
 * Settings → Hooks — read-only Pre/Post/Stop tips (SSOT §9.2).
 */

import { loadRuntimeConfigSafe, resolveConfigPath, resolveLioraHome } from '@superliora/sdk';

import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { buildHooksSettingsLines } from '../../../utils/hooks/hooks-glance';

import type { SlashCommandHost } from '../../hub/dispatch';

async function loadHooksGlance(host: SlashCommandHost): Promise<{
  readonly registry?: {
    readonly totalCount: number;
    readonly events: Readonly<Record<string, number>>;
  };
  readonly pluginHookCount?: number;
  readonly enabledPluginCount?: number;
  readonly configPath: string;
}> {
  let configPath = '(unknown)';
  try {
    const homeDir = host.harness.homeDir ?? resolveLioraHome();
    configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
    loadRuntimeConfigSafe(configPath);
  } catch {
    /* read-only */
  }

  try {
    const session = host.requireSession();
    const [registry, plugins] = await Promise.all([
      session.getHookRegistry(),
      session.listPlugins(),
    ]);
    const enabled = plugins.filter((p) => p.enabled);
    const hookCount = enabled.reduce((sum, p) => sum + (p.hookCount ?? 0), 0);
    return {
      registry,
      pluginHookCount: hookCount,
      enabledPluginCount: enabled.length,
      configPath,
    };
  } catch {
    return { configPath };
  }
}

export function showHooksSettings(host: SlashCommandHost): void {
  void showHooksSettingsPanel(host);
}

async function showHooksSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadHooksGlance(host);
  const lines = buildHooksSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Hooks ',
    enterBeatSeed: 'hooks',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
