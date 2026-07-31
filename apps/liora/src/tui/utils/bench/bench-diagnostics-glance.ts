/**
 * Bench / Diagnostics settings glance — /bench, /ops, visual smoke (SSOT §9.2).
 */

import { formatRedteamSoftSuitePresentLine } from '@superliora/sdk';

/** Compact /bench tip — Settings → Bench / Diagnostics picker + status panel. */
export const BENCH_SLASH_TIP =
  '/bench — latest evidence score, pass rate, holdout, replay hints · default evidence/superliora-provider-bench/final-quality-gate · pass a path to override.';

/** Compact /ops tip — Settings → Bench / Diagnostics picker + status panel. */
export const OPS_SLASH_TIP =
  '/ops — Ops Theatre 4-pane grid: Mission/Fleet · git diff · channel health · intervention tray · Enter focuses approval · Esc dismisses.';

export function buildBenchDiagnosticsSettingsLines(): readonly string[] {
  return [
    '── Bench / Diagnostics (read-only) ───────────',
    'Quality gates + live ops surfaces — Sovereign Reform §9.2 / §12.',
    '',
    '── Slash commands ───────────────────────────',
    '· /bench — latest evidence score, pass rate, holdout, replay hints',
    '· /ops — Ops Theatre: agents · goal · git churn · cache · Never-Halt',
    '· /preflight — readiness matrix (bench age, search, eyes, MCP)',
    '',
    '── Visual smoke (soft) ──────────────────────',
    '· pnpm -C apps/liora run smoke:visual — PTY chrome → .superliora/visual-smoke/latest.{ansi,txt}',
    '· Ops Theatre grid: renderOpsTheatreSmokeGrid() in tui/features/ops-theatre/smoke-fixture.ts',
    '· Hand-diff stub: .superliora/visual-smoke/ops-theatre.txt (Fleet · Goal · Git · Health panes)',
    '',
    '── W6 redteam (live) ────────────────────────',
    `· ${formatRedteamSoftSuitePresentLine()}`,
    '',
    '── Branding debt (glance-only) ──────────────',
    '· Public copy prefers Bench; /bench panel uses Bench (SSOT)',
    '· Sovereign Reform: keep Mission/Fleet wording; drop Ultra* on user surfaces',
    '· Tool-name branding debt gate: pnpm run check:branding (3 compat aliases)',
    '',
    '── Export (future) ──────────────────────────',
    '· Trace export + cache miss dump — Settings → Cache + Host stubs',
    '· Index bench timing — Settings → Index when RepoIndex lands',
    '',
    'No export trace or cache-miss dump actions here until diagnostics slice ships.',
  ];
}
