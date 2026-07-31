import { describe, expect, it, vi } from 'vitest';

import { showBenchDiagnosticsSettings } from '#/tui/commands/config/bench-diagnostics-settings';

describe('bench-diagnostics settings stub', () => {
  it('mounts read-only bench panel with /bench, /ops, and visual smoke tips', () => {
    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as never;

    showBenchDiagnosticsSettings(host);

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
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
