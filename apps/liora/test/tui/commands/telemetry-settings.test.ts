import { describe, expect, it, vi } from 'vitest';

import { showTelemetrySettings } from '#/tui/commands/config/telemetry-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

describe('telemetry-settings', () => {
  it('renders read-only telemetry panel from harness config + live glance', () => {
    const host = {
      harness: {
        homeDir: '/home/.superliora',
        configPath: '/home/.superliora/config.toml',
      },
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as unknown as Parameters<typeof showTelemetrySettings>[0];

    showTelemetrySettings(host);

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    const [panel] = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0] as [
      UsagePanelComponent,
    ];
    const body = panel.snapshotBodyLines(0).join('\n');
    expect(body).toContain('Telemetry (read-only)');
    expect(body).toContain('Config opt-in:');
    expect(body).toContain('Live sink:');
    expect(body).toContain('Local-only posture');
    expect(body).toContain('config.toml');
    expect(body).toContain('SUPERLIORA_TELEMETRY');
  });
});
