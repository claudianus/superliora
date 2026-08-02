/**
 * Settings → Telemetry — status glance + config toggles (SSOT §9.2).
 */

import { resolveConfigPath, resolveLioraHome } from '@superliora/sdk';
import { isTelemetryDisabledByEnv, TELEMETRY_DISABLE_ENV } from '@superliora/telemetry';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import {
  buildTelemetryConfigPatch,
  buildTelemetrySettingsLines,
  loadTelemetryGlance,
  TELEMETRY_LOCAL_ONLY_TIP,
  TELEMETRY_OPT_OUT_TIP,
} from '../../../utils/telemetry/telemetry-glance';

import type { SlashCommandHost } from '../../hub/dispatch';

export { TELEMETRY_LOCAL_ONLY_TIP, TELEMETRY_OPT_OUT_TIP };

async function readConfigTelemetryEnabled(host: SlashCommandHost): Promise<{
  readonly enabled: boolean;
  readonly configPath: string;
}> {
  try {
    const homeDir = host.harness.homeDir ?? resolveLioraHome();
    const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
    const config = await host.harness.getConfig({ reload: true });
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
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Telemetry',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Telemetry status',
          description: 'Config opt-in · live sink · env overrides · endpoint glance.',
        },
        {
          value: 'on',
          label: 'Telemetry ON (opt-in)',
          description: 'harness.setConfig → telemetry = true · restart to attach live sink.',
        },
        {
          value: 'off',
          label: 'Telemetry OFF (ZDR default)',
          description: 'harness.setConfig → telemetry = false · local-only posture.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showTelemetrySettingsPanel(host);
          return;
        }
        if (value === 'on') {
          void setTelemetry(host, true);
          return;
        }
        if (value === 'off') {
          void setTelemetry(host, false);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Telemetry' },
  );
}

async function setTelemetry(host: SlashCommandHost, enabled: boolean): Promise<void> {
  if (enabled && isTelemetryDisabledByEnv(process.env)) {
    host.showStatus(
      `${TELEMETRY_DISABLE_ENV} is set — sink stays off until env is cleared. Config opt-in saved.`,
      'warning',
    );
  }
  try {
    await host.harness.setConfig(buildTelemetryConfigPatch(enabled));
    host.showStatus(
      enabled
        ? 'Telemetry ON — usage analytics opt-in saved. Restart liora to attach live sink.'
        : 'Telemetry OFF — ZDR-friendly default. Restart liora to detach live sink.',
      enabled ? 'success' : 'warning',
    );
  } catch (error) {
    host.showStatus(
      `Failed to update telemetry: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function showTelemetrySettingsPanel(host: SlashCommandHost): Promise<void> {
  const config = await readConfigTelemetryEnabled(host);
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
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
