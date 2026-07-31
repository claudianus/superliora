import { describe, expect, it, vi } from 'vitest';

import {
  BENCH_SLASH_TIP,
  OPS_SLASH_TIP,
  showBenchDiagnosticsSettings,
} from '#/tui/commands/config/diagnostics/bench-diagnostics-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeBenchDiagnosticsHost() {
  const transcriptContainer = { addChild: vi.fn() };
  return {
    state: {
      transcriptContainer,
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
    },
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectBenchDiagnosticsAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('bench diagnostics settings tips', () => {
  it('exports /bench and /ops slash tips', () => {
    expect(BENCH_SLASH_TIP).toContain('/bench');
    expect(BENCH_SLASH_TIP).toContain('final-quality-gate');
    expect(OPS_SLASH_TIP).toContain('/ops');
    expect(OPS_SLASH_TIP).toContain('Ops Theatre');
  });
});

describe('showBenchDiagnosticsSettings', () => {
  it('mounts ChoicePicker with status and read-only tip actions', () => {
    const host = makeBenchDiagnosticsHost();
    showBenchDiagnosticsSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual(['status', 'tip-bench', 'tip-ops']);
  });

  it('shows /bench tip via showStatus', () => {
    const host = makeBenchDiagnosticsHost();
    showBenchDiagnosticsSettings(host);
    selectBenchDiagnosticsAction(host, 'tip-bench');
    expect(host.showStatus).toHaveBeenCalledWith(BENCH_SLASH_TIP, 'info');
  });

  it('shows /ops tip via showStatus', () => {
    const host = makeBenchDiagnosticsHost();
    showBenchDiagnosticsSettings(host);
    selectBenchDiagnosticsAction(host, 'tip-ops');
    expect(host.showStatus).toHaveBeenCalledWith(OPS_SLASH_TIP, 'info');
  });

  it('mounts read-only bench panel with /bench, /ops, and visual smoke tips', () => {
    const host = makeBenchDiagnosticsHost();
    showBenchDiagnosticsSettings(host);
    selectBenchDiagnosticsAction(host, 'status');

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('/bench');
    expect(lines).toContain('/ops');
    expect(lines).toContain('smoke:visual');
    expect(lines).toContain('.superliora/visual-smoke/ops-theatre.txt');
    expect(lines).toContain('renderOpsTheatreSmokeGrid');
    expect(lines).toContain('Fleet · Goal · Git · Health');
    expect(lines).toContain('Bench (SSOT)');
    expect(lines).toContain('Branding debt (glance-only)');
    expect(lines).not.toContain('.superliora/bench/internal-latest.md');
    expect(lines).not.toContain('── Session (live) ─');
    expect(lines).toContain('No export trace');
    expect(lines).toContain('W6 redteam (live)');
    expect(lines).toContain('W6 redteam suite: present');
    expect(lines).toContain('packages/agent-core/test/security/redteam-soft.test.ts');
  });
});
