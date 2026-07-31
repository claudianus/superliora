import { describe, expect, it, vi } from 'vitest';

import { showBenchDiagnosticsSettings } from '#/tui/commands/config/bench-diagnostics-settings';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

describe('bench-diagnostics settings stub', () => {
  it('mounts read-only bench panel with /bench, /ops, and visual smoke tips', () => {
    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as unknown as SlashCommandHost;

    showBenchDiagnosticsSettings(host);

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('/bench');
    expect(lines).toContain('/ops');
    expect(lines).toContain('smoke:visual');
    expect(lines).toContain('.superliora/visual-smoke/ops-theatre.txt');
    expect(lines).toContain('renderOpsTheatreSmokeGrid');
    expect(lines).toContain('Fleet · Goal · Git · Health');
    expect(lines).toContain('Bench (SSOT)');
    expect(lines).toContain('Branding debt');
    expect(lines).not.toContain('.superliora/bench/internal-latest.md');
    expect(lines).not.toContain('── Session (live) ─');
    expect(lines).toContain('No export trace');
    expect(lines).toContain('W6 redteam (live)');
    expect(lines).toContain('W6 redteam suite: present');
    expect(lines).toContain('packages/agent-core/test/security/redteam-soft.test.ts');
  });
});
