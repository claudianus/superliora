/**
 * UsagePanelComponent — wraps pre-coloured `/usage` lines in a blue box
 * border with a left indent, mirroring the PlanBoxComponent layout so
 * the pattern stays consistent across command-triggered panels.
 */

import type { Component } from '#/tui/renderer';
import {
  fitRendererFrameTitle,
  renderRendererFrameRows,
  renderRendererRatioProgressBar,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';
import type { SessionUsage, TokenUsage } from '@superliora/sdk';

import {
  formatTokenCount,
  ratioSeverity,
  safeUsageRatio,
} from '#/utils/usage/usage-format';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import {
  appearanceAnimationNow,
  ENTER_BEAT_MS,
  getActiveAppearancePreferences,
  renderEnterBeat,
  renderPulseText,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

const LEFT_MARGIN = 2;
const SIDE_PADDING = 1;
const BOX_OVERHEAD = LEFT_MARGIN + 2 + 2 * SIDE_PADDING;
/** Align with soft compaction trigger (0.70) and async pre-rot wrap-up (0.55). */
const CONTEXT_COMPACT_RATIO = 0.70;
const CONTEXT_WRAP_UP_RATIO = 0.55;
const CACHE_READY_RATIO = 0.5;
/** Fill animation for plan bars after data arrives (clock-driven; no setInterval). */
const USAGE_FILL_MS = 400;
const USAGE_FRAME_INTERVAL_MS = 80;

type Colorize = (text: string) => string;

export interface ManagedUsageRow {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly resetHint?: string;
}

export interface ManagedAccountUsageReport {
  readonly accountKey: string;
  readonly label?: string;
  readonly isPrimary?: boolean;
  readonly summary: ManagedUsageRow | null;
  readonly limits: readonly ManagedUsageRow[];
  readonly error?: string;
  readonly status?: 'ok' | 'error' | 'loading';
}

export interface ManagedUsageReport {
  readonly summary: ManagedUsageRow | null;
  readonly limits: readonly ManagedUsageRow[];
  readonly accounts?: readonly ManagedAccountUsageReport[];
}

export interface UsageReportOptions {
  readonly sessionUsage?: SessionUsage;
  readonly sessionUsageError?: string;
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
  /** 0..1 multiplier applied to plan usage bars during ambient fill animation. */
  readonly managedUsageFillProgress?: number;
}

export interface ManagedUsageReportLineOptions {
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
  readonly managedUsageFillProgress?: number;
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function usageByModel(usage: SessionUsage | undefined): Record<string, TokenUsage> {
  return (usage as { readonly byModel?: Record<string, TokenUsage> } | undefined)?.byModel ?? {};
}

function usageInputTotal(usage: TokenUsage): number {
  return (
    usageNumber(usage.inputOther) +
    usageNumber(usage.inputCacheRead) +
    usageNumber(usage.inputCacheCreation)
  );
}

function formatCacheShare(cacheRead: number, cacheWrite: number, input: number): string {
  if (input <= 0) return '0%';
  return `${Math.round(((cacheRead + cacheWrite) / input) * 100)}%`;
}

function cacheEfficiencyValues(usage: SessionUsage | undefined): {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly ratio: number;
} {
  const entries = Object.values(usageByModel(usage));
  if (entries.length === 0) {
    return {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      ratio: 0,
    };
  }

  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const row of entries) {
    input += usageInputTotal(row);
    cacheRead += usageNumber(row.inputCacheRead);
    cacheWrite += usageNumber(row.inputCacheCreation);
  }
  if (input <= 0) {
    return {
      input,
      cacheRead,
      cacheWrite,
      ratio: 0,
    };
  }
  return {
    input,
    cacheRead,
    cacheWrite,
    ratio: Math.max(0, Math.min((cacheRead + cacheWrite) / input, 1)),
  };
}

function cacheEfficiencyNext(ratio: number, cacheRead: number, contextUsage: number): string {
  if (safeUsageRatio(contextUsage) >= CONTEXT_COMPACT_RATIO) return 'Run /compact before long work.';
  if (ratio >= CACHE_READY_RATIO && cacheRead > 0) return 'Continue; cache is ready for long work.';
  if (ratio > 0) return 'Continue; cache is still warming.';
  return 'Continue; cache warms after repeated context.';
}

function buildSessionUsageSection(
  usage: SessionUsage | undefined,
  error: string | undefined,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  if (error !== undefined) return [errorStyle(`  ${error}`)];
  const entries = Object.entries(usageByModel(usage));
  if (entries.length === 0) {
    return [
      muted('  No token usage recorded yet. Send a message to start tracking.'),
      `  ${muted('session')}  input ${value(formatTokenCount(0))}  output ${value(
        formatTokenCount(0),
      )}  total ${value(formatTokenCount(0))}`,
      `  ${muted('session cache')}  read ${value(formatTokenCount(0))}  write ${value(
        formatTokenCount(0),
      )}  share ${value(formatCacheShare(0, 0, 0))}`,
    ];
  }

  const lines: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  for (const [model, row] of entries) {
    const input = usageInputTotal(row);
    const cacheRead = usageNumber(row.inputCacheRead);
    const cacheWrite = usageNumber(row.inputCacheCreation);
    const output = usageNumber(row.output);
    totalInput += input;
    totalOutput += output;
    lines.push(
      `  ${muted(model)}  input ${value(formatTokenCount(input))}  output ${value(
        formatTokenCount(output),
      )}  total ${value(formatTokenCount(input + output))}`,
    );
    lines.push(
      `  ${muted(`${model} cache`)}  read ${value(formatTokenCount(cacheRead))}  write ${value(
        formatTokenCount(cacheWrite),
      )}  share ${value(formatCacheShare(cacheRead, cacheWrite, input))}`,
    );
  }
  if (entries.length > 1) {
    lines.push(
      `  ${muted('total')}  input ${value(formatTokenCount(totalInput))}  output ${value(
        formatTokenCount(totalOutput),
      )}  total ${value(formatTokenCount(totalInput + totalOutput))}`,
    );
  }
  return lines;
}

function usedRatio(row: ManagedUsageRow): number {
  return row.limit > 0 ? Math.max(0, Math.min(row.used / row.limit, 1)) : 0;
}

function severityColorToken(sev: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' {
  return sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';
}

function shortAccountKey(accountKey: string): string {
  const trimmed = accountKey.trim();
  if (trimmed.length === 0) return 'account';
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function accountDisplayName(account: ManagedAccountUsageReport): string {
  const label = account.label?.trim();
  if (label !== undefined && label.length > 0) return label;
  return shortAccountKey(account.accountKey);
}

function renderManagedUsageRows(
  rows: readonly ManagedUsageRow[],
  value: Colorize,
  muted: Colorize,
  fillProgress: number,
  indent: string,
): string[] {
  if (rows.length === 0) return [muted(`${indent}No usage data available.`)];
  const labelWidth = Math.max(10, ...rows.map((r) => r.label.length));
  const pctWidth = Math.max(...rows.map((r) => `${Math.round(usedRatio(r) * 100)}% used`.length));
  const out: string[] = [];
  for (const row of rows) {
    const ratioUsed = usedRatio(row);
    const displayRatio = Math.max(0, Math.min(1, ratioUsed * fillProgress));
    const pct = `${Math.round(ratioUsed * 100)}% used`;
    const barColor = severityColorToken(ratioSeverity(ratioUsed));
    const barColoured = renderRendererRatioProgressBar({
      ratio: displayRatio,
      width: 20,
      filledStyle: (text) => currentTheme.fg(barColor, text),
      emptyStyle: (text) => currentTheme.fg(barColor, text),
    });
    const label = row.label.padEnd(labelWidth, ' ');
    const resetStr = row.resetHint ? `  ${muted(row.resetHint)}` : '';
    out.push(
      `${indent}${muted(label)}  ${barColoured}  ${value(pct.padEnd(pctWidth, ' '))}${resetStr}`,
    );
  }
  return out;
}

function renderLoadingManagedBars(muted: Colorize, fillProgress: number, indent: string): string[] {
  const shimmerRatio =
    0.15 +
    0.35 *
      (0.5 + 0.5 * Math.sin(fillProgress * Math.PI * 2 + appearanceAnimationNow() / 180));
  const barColoured = renderRendererRatioProgressBar({
    ratio: Math.max(0, Math.min(1, shimmerRatio)),
    width: 20,
    filledStyle: (text) => currentTheme.fg('textDim', text),
    emptyStyle: (text) => currentTheme.fg('textDim', text),
  });
  return [`${indent}${muted('loading…'.padEnd(10, ' '))}  ${barColoured}  ${muted('…')}`];
}

function buildManagedUsageSection(
  usage: ManagedUsageReport | undefined,
  error: string | undefined,
  accent: Colorize,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
  fillProgress = 1,
): string[] {
  if (error !== undefined) return [accent('Plan usage'), errorStyle(`  ${error}`)];
  if (usage === undefined) return [];

  const accounts = usage.accounts;
  if (accounts !== undefined && accounts.length > 0) {
    const out: string[] = [accent('Plan usage')];
    for (let i = 0; i < accounts.length; i += 1) {
      const account = accounts[i]!;
      if (i > 0) out.push('');
      const name = accountDisplayName(account);
      const primaryBadge = account.isPrimary ? muted(' · primary') : '';
      out.push(`  ${value(name)}${primaryBadge}`);
      const status = account.status ?? (account.error !== undefined ? 'error' : 'ok');
      if (status === 'loading') {
        out.push(...renderLoadingManagedBars(muted, fillProgress, '    '));
        continue;
      }
      if (status === 'error' || account.error !== undefined) {
        out.push(errorStyle(`    ${account.error ?? 'Failed to load usage.'}`));
        continue;
      }
      const rows: ManagedUsageRow[] = [];
      if (account.summary !== null) rows.push(account.summary);
      rows.push(...account.limits);
      if (rows.length === 0) {
        out.push(muted('    No usage data available.'));
        continue;
      }
      out.push(...renderManagedUsageRows(rows, value, muted, fillProgress, '    '));
    }
    return out;
  }

  const { summary, limits } = usage;
  if (summary === null && limits.length === 0) {
    return [accent('Plan usage'), muted('  No usage data available.')];
  }

  const rows: ManagedUsageRow[] = [];
  if (summary !== null) rows.push(summary);
  rows.push(...limits);
  return [accent('Plan usage'), ...renderManagedUsageRows(rows, value, muted, fillProgress, '  ')];
}

export function buildManagedUsageReportLines(options: ManagedUsageReportLineOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);
  const fill =
    options.managedUsageFillProgress === undefined
      ? 1
      : Math.max(0, Math.min(1, options.managedUsageFillProgress));

  return buildManagedUsageSection(
    options.managedUsage,
    options.managedUsageError,
    accent,
    value,
    muted,
    errorStyle,
    fill,
  );
}

export function buildUsageReportLines(options: UsageReportOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);
  const severityColor = (sev: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' =>
    sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';

  const lines: string[] = [
    accent('Session usage'),
    ...buildSessionUsageSection(
      options.sessionUsage,
      options.sessionUsageError,
      value,
      muted,
      errorStyle,
    ),
  ];

  const cacheEfficiency = cacheEfficiencyValues(options.sessionUsage);
  const cacheRatio = safeUsageRatio(cacheEfficiency.ratio);
  const cachePct = `${Math.round(cacheRatio * 100)}% cached input`;
  const cacheColor: ColorToken =
    cacheRatio >= CACHE_READY_RATIO ? 'success' : cacheRatio > 0 ? 'warning' : 'error';
  const cacheBarColoured = renderRendererRatioProgressBar({
    ratio: cacheRatio,
    width: 20,
    filledStyle: (text) => currentTheme.fg(cacheColor, text),
    emptyStyle: (text) => currentTheme.fg(cacheColor, text),
  });
  lines.push('');
  lines.push(accent('Cache efficiency'));
  lines.push(
    `  ${cacheBarColoured}  ${value(cachePct)}  ` +
      muted(
        `r ${formatTokenCount(cacheEfficiency.cacheRead)} · w ${formatTokenCount(cacheEfficiency.cacheWrite)}`,
      ),
  );
  lines.push(
    `  ${muted('Next')}       ${value(
      cacheEfficiencyNext(cacheRatio, cacheEfficiency.cacheRead, options.contextUsage),
    )}`,
  );

  if (options.maxContextTokens > 0) {
    const ratio = safeUsageRatio(options.contextUsage);
    const pct = `${(ratio * 100).toFixed(1)}%`;
    const barColor = severityColor(ratioSeverity(ratio));
    const barColoured = renderRendererRatioProgressBar({
      ratio,
      width: 20,
      filledStyle: (text) => currentTheme.fg(barColor, text),
      emptyStyle: (text) => currentTheme.fg(barColor, text),
    });
    const remaining = Math.max(0, options.maxContextTokens - options.contextTokens);
    const next =
      ratio >= CONTEXT_COMPACT_RATIO
        ? 'Run /compact before long work.'
        : ratio >= CONTEXT_WRAP_UP_RATIO
          ? 'Finish the current step, then /compact.'
          : 'Continue; plenty of room for long work.';
    lines.push('');
    lines.push(accent('Context window'));
    lines.push(
      `  ${barColoured}  ${value(pct.padStart(6, ' '))}  ` +
        muted(
          `(${formatTokenCount(options.contextTokens)} / ${formatTokenCount(
            options.maxContextTokens,
          )})`,
        ),
    );
    lines.push(`  ${muted('Remaining')}  ${value(`${formatTokenCount(remaining)} tokens`)}`);
    lines.push(`  ${muted('Next')}       ${value(next)}`);
  }

  const managedSection = buildManagedUsageReportLines({
    managedUsage: options.managedUsage,
    managedUsageError: options.managedUsageError,
    managedUsageFillProgress: options.managedUsageFillProgress,
  });
  if (managedSection.length > 0) {
    lines.push('');
    lines.push(...managedSection);
  }

  return lines;
}

export type UsagePanelPhase = 'loading' | 'ready';

export interface UsagePanelComponentOptions {
  readonly buildLines: (fillProgress: number) => readonly string[];
  readonly borderToken?: ColorToken;
  readonly title?: string;
  /** Request a layout/content re-render for clock-driven animation frames. */
  readonly requestRender?: (() => void) | undefined;
  readonly phase?: UsagePanelPhase;
  readonly fillStartedAtMs?: number | undefined;
  /** Seed for the open enter beat (defaults to trimmed title). */
  readonly enterBeatSeed?: string;
  readonly openedAtMs?: number;
}

/**
 * Bordered `/usage` panel. Supports optional loading → filled animation for
 * Plan usage bars via the shared appearance animation clock (no private timers).
 */
export class UsagePanelComponent implements Component {
  /** Cached coloured lines; rebuilt from `buildLines` on every invalidate. */
  private lines: readonly string[];
  private phase: UsagePanelPhase;
  private fillStartedAtMs: number | undefined;
  private lastFrameTickMs = 0;
  private readonly buildLines: (fillProgress: number) => readonly string[];
  private readonly borderToken: ColorToken;
  private readonly title: string;
  private readonly requestRender: (() => void) | undefined;
  private readonly enterBeatSeed: string;
  private readonly openedAtMs: number;

  constructor(
    buildLines: (() => readonly string[]) | UsagePanelComponentOptions,
    borderToken: ColorToken = 'primary',
    title: string = ' Usage ',
  ) {
    if (typeof buildLines === 'function') {
      this.buildLines = (_fillProgress: number) => buildLines();
      this.borderToken = borderToken;
      this.title = title;
      this.requestRender = undefined;
      this.phase = 'ready';
      this.fillStartedAtMs = undefined;
      this.enterBeatSeed = title.trim().toLowerCase() || 'panel';
      this.openedAtMs = appearanceAnimationNow();
    } else {
      this.buildLines = buildLines.buildLines;
      this.borderToken = buildLines.borderToken ?? 'primary';
      this.title = buildLines.title ?? ' Usage ';
      this.requestRender = buildLines.requestRender;
      this.phase = buildLines.phase ?? 'ready';
      this.fillStartedAtMs = buildLines.fillStartedAtMs;
      this.enterBeatSeed =
        buildLines.enterBeatSeed ?? (this.title.trim().toLowerCase() || 'panel');
      this.openedAtMs = buildLines.openedAtMs ?? appearanceAnimationNow();
    }
    this.lines = this.buildLines(this.resolveFillProgress());
  }

  setPhase(phase: UsagePanelPhase, options: { readonly fillStartedAtMs?: number } = {}): void {
    this.phase = phase;
    if (options.fillStartedAtMs !== undefined) {
      this.fillStartedAtMs = options.fillStartedAtMs;
    } else if (phase === 'ready' && this.fillStartedAtMs === undefined) {
      this.fillStartedAtMs = appearanceAnimationNow();
    } else if (phase === 'loading') {
      this.fillStartedAtMs = undefined;
    }
    this.lastFrameTickMs = 0;
    this.lines = this.buildLines(this.resolveFillProgress());
  }

  invalidate(): void {
    // Report bodies embed palette colours, so a theme switch must re-run the
    // builder to repaint the cached lines (the data itself is captured).
    this.lines = this.buildLines(this.resolveFillProgress());
  }

  render(width: number): string[] {
    this.tickClockDrivenAnimation();
    // Rebuild when ambient fill progress advances between frames.
    this.lines = this.buildLines(this.resolveFillProgress());

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const appearance = getActiveAppearancePreferences();
    const paint = (s: string): string => currentTheme.fg(this.borderToken, s);
    const availableInterior = safeWidth - BOX_OVERHEAD;
    const titleText =
      this.phase === 'loading' && shouldRenderAmbientEffects(appearance)
        ? renderPulseText(this.title, 'usage-panel:title', this.borderToken)
        : this.title;
    if (availableInterior < 1) {
      return [
        truncateToWidth(this.title.trim(), safeWidth, '…'),
        ...this.lines.map((line) => truncateToWidth(line, safeWidth, '…')),
      ];
    }

    const indent = ' '.repeat(LEFT_MARGIN);
    const longestLine = this.lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
    const contentWidth = Math.max(
      1,
      Math.min(availableInterior, Math.max(longestLine, visibleWidth(this.title))),
    );
    const horzLen = contentWidth + 2 * SIDE_PADDING;
    const title = fitRendererFrameTitle(titleText, horzLen, '…');
    const frame = renderRendererFrameRows({
      title,
      titlePlacement: 'flush',
      borderKind: 'rounded',
      content: this.lines,
      width: horzLen + 2,
      height: this.lines.length + 2,
      paddingX: SIDE_PADDING,
      borderStyle: paint,
      titleStyle: paint,
      ellipsis: '…',
    });
    const body = frame.map((line) => truncateToWidth(indent + line, safeWidth, '…'));
    if (!this.isEnterBeatActive(appearance)) return body;
    const beat = renderEnterBeat(
      this.title.trim() || 'Panel',
      safeWidth,
      this.enterBeatSeed,
      this.openedAtMs,
      appearance,
    ).map((line) => truncateToWidth(line, safeWidth, '…'));
    return [...beat, ...body];
  }

  private resolveFillProgress(): number {
    const appearance = getActiveAppearancePreferences();
    if (!shouldRenderAmbientEffects(appearance)) return 1;
    if (this.phase === 'loading') {
      const t = appearanceAnimationNow() / 500;
      return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2));
    }
    if (this.fillStartedAtMs === undefined) return 1;
    const elapsed = appearanceAnimationNow() - this.fillStartedAtMs;
    if (elapsed >= USAGE_FILL_MS) return 1;
    return Math.max(0, Math.min(1, elapsed / USAGE_FILL_MS));
  }

  private isEnterBeatActive(
    appearance = getActiveAppearancePreferences(),
  ): boolean {
    if (!shouldRenderAmbientEffects(appearance)) return false;
    const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
    const enterMs = mode === 'subtle' ? ENTER_BEAT_MS * 1.2 : ENTER_BEAT_MS;
    return appearanceAnimationNow() - this.openedAtMs < enterMs;
  }

  private needsAnimationFrame(): boolean {
    if (this.requestRender === undefined) return false;
    const appearance = getActiveAppearancePreferences();
    if (!shouldRenderAmbientEffects(appearance)) return false;
    if (this.isEnterBeatActive(appearance)) return true;
    if (this.phase === 'loading') return true;
    if (this.fillStartedAtMs === undefined) return false;
    return appearanceAnimationNow() - this.fillStartedAtMs < USAGE_FILL_MS;
  }

  private tickClockDrivenAnimation(): void {
    if (!this.needsAnimationFrame() || this.requestRender === undefined) return;
    const now = appearanceAnimationNow();
    if (this.lastFrameTickMs !== 0 && now - this.lastFrameTickMs < USAGE_FRAME_INTERVAL_MS) return;
    this.lastFrameTickMs = now;
    this.requestRender();
  }
}
