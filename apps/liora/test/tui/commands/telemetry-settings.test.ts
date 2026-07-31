import { describe, expect, it, vi } from 'vitest';

import {
  showTelemetrySettings,
  TELEMETRY_LOCAL_ONLY_TIP,
  TELEMETRY_OPT_OUT_TIP,
} from '#/tui/commands/config/telemetry/telemetry-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost(options: {
  telemetry?: boolean;
  setConfig?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    state: {
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
      centerModalStack: [] as readonly unknown[],
      appState: {},
    },
    harness: {
      homeDir: '/home/.superliora',
      configPath: '/home/.superliora/config.toml',
      getConfig: vi.fn(async () => ({ telemetry: options.telemetry ?? false })),
      setConfig: options.setConfig ?? vi.fn(async () => ({ telemetry: true })),
    },
    showStatus: vi.fn(),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
  } as unknown as SlashCommandHost;
}

function pickerFromHost(host: SlashCommandHost): ChoicePickerComponent {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  return picker as ChoicePickerComponent;
}

function selectPickerOption(host: SlashCommandHost, value: string): void {
  const picker = pickerFromHost(host);
  (picker as unknown as { opts: { onSelect: (v: string) => void } }).opts.onSelect(value);
}

describe('telemetry-settings', () => {
  it('mounts ChoicePicker with status, toggles, and tips', () => {
    const host = makeHost();
    showTelemetrySettings(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const picker = pickerFromHost(host);
    const labels = (picker as unknown as { opts: { options: { label: string }[] } }).opts.options.map(
      (option) => option.label,
    );
    expect(labels).toContain('Telemetry status');
    expect(labels).toContain('Telemetry ON (opt-in)');
    expect(labels).toContain('Telemetry OFF (ZDR default)');
    expect(labels).toContain('Local-only posture tip');
    expect(labels).toContain('Opt-out tip');
  });

  it('renders status panel from harness config + live glance', async () => {
    const host = makeHost({ telemetry: false });
    showTelemetrySettings(host);
    selectPickerOption(host, 'status');
    await vi.waitFor(() =>
      expect((host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(0),
    );

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const body = panel.snapshotBodyLines(0).join('\n');
    expect(body).toContain('Telemetry');
    expect(body).toContain('Config opt-in:');
    expect(body).toContain('Live sink:');
    expect(body).toContain('Local-only posture');
    expect(body).toContain('config.toml');
    expect(body).toContain('SUPERLIORA_TELEMETRY');
  });

  it('writes telemetry ON via setConfig', async () => {
    const setConfig = vi.fn(async () => ({ telemetry: true }));
    const host = makeHost({ setConfig });
    showTelemetrySettings(host);
    selectPickerOption(host, 'on');
    await vi.waitFor(() => expect(setConfig).toHaveBeenCalledWith({ telemetry: true }));
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Telemetry ON'),
      'success',
    );
  });

  it('writes telemetry OFF via setConfig', async () => {
    const setConfig = vi.fn(async () => ({ telemetry: false }));
    const host = makeHost({ setConfig });
    showTelemetrySettings(host);
    selectPickerOption(host, 'off');
    await vi.waitFor(() => expect(setConfig).toHaveBeenCalledWith({ telemetry: false }));
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Telemetry OFF'),
      'warning',
    );
  });

  it('shows local-only and opt-out tips', () => {
    const host = makeHost();
    showTelemetrySettings(host);
    selectPickerOption(host, 'tip-local');
    expect(host.showStatus).toHaveBeenCalledWith(TELEMETRY_LOCAL_ONLY_TIP, 'info');
    selectPickerOption(host, 'tip-opt-out');
    expect(host.showStatus).toHaveBeenCalledWith(TELEMETRY_OPT_OUT_TIP, 'info');
  });
});
