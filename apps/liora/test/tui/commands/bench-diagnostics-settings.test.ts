import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLioraHarness } from '@superliora/sdk';

import {
  BENCH_SLASH_TIP,
  showBenchDiagnosticsSettings,
} from '#/tui/commands/config/diagnostics/bench-diagnostics-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import {
  buildHostTtftExportLines,
  buildHostTtftExportPayload,
  formatHostTtftExportJson,
} from '#/tui/utils/bench/bench-diagnostics-glance';
import {
  SESSION_TRACE_DUMP_SCHEMA,
  buildSessionTraceDumpPayload,
} from '#/tui/utils/session/session-trace-dump';

let homeDir: string;
let workDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'liora-bench-diag-home-'));
  workDir = await mkdtemp(join(tmpdir(), 'liora-bench-diag-work-'));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
});

function makeBenchDiagnosticsHost(options: {
  lastStepTtft?: {
    ms: number;
    turnId?: number;
    step?: number;
    requestBuildMs?: number;
    serverFirstTokenMs?: number;
  } | null;
  lastStepTtftMsWindow?: readonly number[] | null;
} = {}) {
  const transcriptContainer = { addChild: vi.fn() };
  const harness = createLioraHarness({ homeDir, projectDir: workDir });
  return {
    state: {
      transcriptContainer,
      centerModalStack: [] as readonly unknown[],
      renderer: { invalidateFrame: vi.fn() },
      appState: {
        lastStepTtft: options.lastStepTtft ?? null,
        lastStepTtftMsWindow: options.lastStepTtftMsWindow ?? null,
      },
    },
    harness,
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
  it('exports the /bench slash tip', () => {
    expect(BENCH_SLASH_TIP).toContain('/bench');
    expect(BENCH_SLASH_TIP).toContain('final-quality-gate');
  });
});

describe('showBenchDiagnosticsSettings', () => {
  it('mounts ChoicePicker with status only — tip-free', () => {
    const host = makeBenchDiagnosticsHost();
    showBenchDiagnosticsSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual(['status']);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });



  it('mounts read-only bench panel with /bench and visual smoke tips', () => {
    const host = makeBenchDiagnosticsHost();
    showBenchDiagnosticsSettings(host);
    selectBenchDiagnosticsAction(host, 'status');

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('/bench');
    expect(lines).toContain('smoke:visual');
    expect(lines).not.toContain('/ops');
    expect(lines).toContain('Bench (SSOT)');
    expect(lines).toContain('Branding debt (glance-only)');
    expect(lines).not.toContain('.superliora/bench/internal-latest.md');
    expect(lines).not.toContain('── Session (live) ─');
    expect(lines).toContain('Session TTFT export');
    expect(lines).toContain('superliora.host_ttft.v1');
    expect(lines).toContain('Last TTFT: (none this session)');
    expect(lines).toContain('Session trace dump');
    expect(lines).toContain('superliora.session_trace.v1');
    expect(lines).toContain('No active session');
    expect(lines).toContain('Cache miss dump');
    expect(lines).toContain('Session TTFT + session trace dump ship in this panel');
    expect(lines).not.toContain('Trace/cache-miss dump still pending');
    expect(lines).toContain('W6 redteam (live)');
    expect(lines).toContain('W6 redteam suite: present');
    expect(lines).toContain('packages/agent-core/test/security/redteam-soft.test.ts');
  });

  it('surfaces session TTFT export JSON when AppState has samples', () => {
    const host = makeBenchDiagnosticsHost({
      lastStepTtft: {
        ms: 300,
        turnId: 2,
        step: 1,
        requestBuildMs: 40,
        serverFirstTokenMs: 260,
      },
      lastStepTtftMsWindow: [100, 200, 300],
    });
    showBenchDiagnosticsSettings(host);
    selectBenchDiagnosticsAction(host, 'status');
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Session TTFT export');
    expect(lines).toContain('superliora.host_ttft.v1');
    expect(lines).toContain('Last TTFT: 300ms');
    expect(lines).toContain('TTFT p50: 200ms');
    expect(lines).toContain('"p50Ms": 200');
    expect(lines).toContain('"samplesMs"');
  });
});

describe('host TTFT export helpers', () => {
  it('builds stable schema payload and JSON', () => {
    const payload = buildHostTtftExportPayload({
      runtimeMode: 'in-process',
      lastStepTtft: { ms: 250, turnId: 1, step: 0 },
      lastStepTtftMsWindow: [100, 250],
      capturedAtIso: '2026-08-02T06:00:00.000Z',
    });
    expect(payload.schema).toBe('superliora.host_ttft.v1');
    expect(payload.p50Ms).toBe(175);
    expect(payload.samplesMs).toEqual([100, 250]);
    const json = formatHostTtftExportJson(payload);
    expect(json).toContain('"capturedAt": "2026-08-02T06:00:00.000Z"');
    const lines = buildHostTtftExportLines({
      runtimeMode: 'in-process',
      lastStepTtft: { ms: 250, turnId: 1, step: 0 },
      lastStepTtftMsWindow: [100, 250],
      capturedAtIso: '2026-08-02T06:00:00.000Z',
    });
    expect(lines.join('\n')).toContain('JSON (copy)');
    expect(lines.join('\n')).toContain('superliora.host_ttft.v1');
  });
});

describe('session trace dump schema (Loop19b)', () => {
  it('uses superliora.session_trace.v1', () => {
    const payload = buildSessionTraceDumpPayload({
      trace: {
        sessionId: 'ses_x',
        agentId: 'main',
        generatedAt: '2026-08-02T00:00:00.000Z',
        completeness: {
          source: 'context_fallback',
          recordCount: 0,
          traceEventCount: 0,
          messageCount: 0,
          filteredInternalMessageCount: 0,
          toolCallCount: 0,
          toolResultCount: 0,
          subagentLifecycleCount: 0,
          ultraworkEventCount: 0,
          redactedCount: 0,
          warnings: ['none'],
        },
        events: [],
      },
      capturedAtIso: '2026-08-02T00:00:01.000Z',
    });
    expect(payload.schema).toBe(SESSION_TRACE_DUMP_SCHEMA);
    expect(payload.schema).toBe('superliora.session_trace.v1');
  });
});
