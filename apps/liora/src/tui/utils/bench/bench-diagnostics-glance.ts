/**
 * Bench / Diagnostics settings glance — /bench, visual smoke (SSOT §9.2).
 * Loop17b: session TTFT export block (Host rolling window SSOT).
 * Loop19b: session trace dump summary (`superliora.session_trace.v1`).
 */

import { formatRedteamSoftSuitePresentLine } from '@superliora/sdk';

import {
  HOST_TTFT_WINDOW_MAX,
  computeHostTtftP50Ms,
  formatHostTtftLine,
  formatHostTtftP50Line,
  type HostRuntimeMode,
  type HostTtftSample,
} from '../host/host-glance';
import {
  buildSessionTraceDumpExportLines,
  buildSessionTraceDumpUnavailableLines,
  type BuildSessionTraceDumpInput,
} from '../session/session-trace-dump';
import { formatTtftDuration } from '#/utils/usage/debug-timing';

/** Compact /bench tip — Settings → Bench / Diagnostics picker + status panel. */
export const BENCH_SLASH_TIP =
  '/bench — latest evidence score, pass rate, holdout, replay hints · default evidence/superliora-provider-bench/final-quality-gate · pass a path to override.';

export interface BenchDiagnosticsTtftExportInput {
  readonly runtimeMode: HostRuntimeMode;
  readonly lastStepTtft?: HostTtftSample | null;
  readonly lastStepTtftMsWindow?: readonly number[] | null;
  /** ISO timestamp for the export snapshot (tests may pin). */
  readonly capturedAtIso?: string;
}

export interface BenchDiagnosticsTtftExport {
  readonly schema: 'superliora.host_ttft.v1';
  readonly capturedAt: string;
  readonly runtimeMode: HostRuntimeMode;
  readonly windowMax: number;
  readonly samplesMs: readonly number[];
  readonly p50Ms: number | null;
  readonly last: HostTtftSample | null;
}

export function buildHostTtftExportPayload(
  input: BenchDiagnosticsTtftExportInput,
): BenchDiagnosticsTtftExport {
  const samples = [...(input.lastStepTtftMsWindow ?? [])];
  const p50 = computeHostTtftP50Ms(samples);
  return {
    schema: 'superliora.host_ttft.v1',
    capturedAt: input.capturedAtIso ?? new Date().toISOString(),
    runtimeMode: input.runtimeMode,
    windowMax: HOST_TTFT_WINDOW_MAX,
    samplesMs: samples,
    p50Ms: p50 ?? null,
    last: input.lastStepTtft ?? null,
  };
}

/** Pretty one-object JSON for clipboard / transcript paste. */
export function formatHostTtftExportJson(payload: BenchDiagnosticsTtftExport): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Human-readable TTFT export lines for Bench / Diagnostics status panel. */
export function buildHostTtftExportLines(
  input: BenchDiagnosticsTtftExportInput,
): readonly string[] {
  const payload = buildHostTtftExportPayload(input);
  const lines: string[] = [
    '── Session TTFT export ──────────────────────',
    `Schema: ${payload.schema}`,
    `Captured: ${payload.capturedAt}`,
    `Path: ${payload.runtimeMode === 'in-process' ? 'in-process' : 'server client'}`,
  ];
  if (payload.last != null) {
    lines.push(formatHostTtftLine(payload.last, payload.runtimeMode));
  } else {
    lines.push('Last TTFT: (none this session)');
  }
  if (payload.samplesMs.length > 0) {
    const p50Line = formatHostTtftP50Line(payload.samplesMs, payload.runtimeMode);
    if (p50Line !== null) lines.push(p50Line);
    const preview = payload.samplesMs
      .slice(-8)
      .map((ms) => formatTtftDuration(ms))
      .join(', ');
    lines.push(
      `Samples (newest last, show ≤8): ${preview}${payload.samplesMs.length > 8 ? ' …' : ''}`,
    );
  } else {
    lines.push('TTFT p50: (no samples — complete a turn with stream timing)');
  }
  lines.push('', '── JSON (copy) ─────────────────────────────');
  for (const line of formatHostTtftExportJson(payload).trimEnd().split('\n')) {
    lines.push(line);
  }
  return lines;
}

export interface BuildBenchDiagnosticsSettingsLinesInput {
  readonly ttft?: BenchDiagnosticsTtftExportInput | null;
  /** Loop19b: compact session trace dump (or unavailable reason). */
  readonly traceDump?: BuildSessionTraceDumpInput | null;
  readonly traceDumpUnavailableReason?: string | null;
}

export function buildBenchDiagnosticsSettingsLines(
  input: BuildBenchDiagnosticsSettingsLinesInput = {},
): readonly string[] {
  const ttftBlock =
    input.ttft !== undefined && input.ttft !== null
      ? ['', ...buildHostTtftExportLines(input.ttft)]
      : [
          '',
          '── Session TTFT export ──────────────────────',
          '· No live sample yet — complete a turn, then reopen this panel.',
          '· Host panel also shows last TTFT + p50 when samples exist.',
        ];

  let traceBlock: readonly string[];
  if (input.traceDump !== undefined && input.traceDump !== null) {
    traceBlock = ['', ...buildSessionTraceDumpExportLines(input.traceDump)];
  } else if (
    input.traceDumpUnavailableReason !== undefined &&
    input.traceDumpUnavailableReason !== null &&
    input.traceDumpUnavailableReason.length > 0
  ) {
    traceBlock = ['', ...buildSessionTraceDumpUnavailableLines(input.traceDumpUnavailableReason)];
  } else {
    traceBlock = [
      '',
      ...buildSessionTraceDumpUnavailableLines(
        'No active session — open a session, then reopen this panel.',
      ),
    ];
  }

  return [
    '── Bench / Diagnostics (read-only) ───────────',
    'Quality gates — Sovereign Reform §9.2 / §12.',
    '',
    '── Slash commands ───────────────────────────',
    '· /bench — latest evidence score, pass rate, holdout, replay hints',
    '',
    '── Visual smoke (soft) ──────────────────────',
    '· pnpm -C apps/liora run smoke:visual — PTY chrome → .superliora/visual-smoke/latest.{ansi,txt}',
    '',
    '── W6 redteam (live) ────────────────────────',
    `· ${formatRedteamSoftSuitePresentLine()}`,
    '',
    '── Branding debt (glance-only) ──────────────',
    '· Public copy prefers Bench; /bench panel uses Bench (SSOT)',
    '· Sovereign Reform: keep Mission/Fleet wording; drop Ultra* on user surfaces',
    '· Tool-name branding debt gate: pnpm run check:branding (3 compat aliases)',
    ...ttftBlock,
    ...traceBlock,
    '',
    '── Export (related) ─────────────────────────',
    '· Cache miss dump — Settings → Cache (`superliora.cache_miss.v1`)',
    '· Full transcript/debug — /export · session debug zip',
    '· Index bench timing — Settings → Index when RepoIndex lands',
    '',
    'Session TTFT + session trace dump ship in this panel (JSON blocks).',
  ];
}
