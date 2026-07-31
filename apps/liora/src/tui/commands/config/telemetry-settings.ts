/**
 * Settings → Telemetry — read-only config opt-in + live sink (SSOT §9.2).
 */

import { loadRuntimeConfigSafe, resolveConfigPath, resolveLioraHome } from '@superliora/sdk';

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildTelemetrySettingsLines,
  loadTelemetryGlance,
} from '../../utils/telemetry/telemetry-glance';

import type { SlashCommandHost } from '../hub/dispatch';

function readConfigTelemetryEnabled(host: SlashCommandHost): {
  readonly enabled: boolean;
  readonly configPath: string;
} {
  try {
    const homeDir = host.harness.homeDir ?? resolveLioraHome();
    const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
    const { config } = loadRuntimeConfigSafe(configPath);
    return {
      enabled: config.telemetry === true,
      configPath,
    };
  } catch {
    return {
      enabled: false,
      configPath: '(unknown)',
    };
  }
}

export function showTelemetrySettings(host: SlashCommandHost): void {
  const config = readConfigTelemetryEnabled(host);
  const glance = loadTelemetryGlance({
    configEnabled: config.enabled,
    configPath: config.configPath,
  });
  const lines = buildTelemetrySettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Telemetry ',
    enterBeatSeed: 'telemetry',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
