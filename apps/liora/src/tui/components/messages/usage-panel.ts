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

const LEFT_MARGIN = 2;
const SIDE_PADDING = 1;
const BOX_OVERHEAD = LEFT_MARGIN + 2 + 2 * SIDE_PADDING;
/** Align with soft compaction trigger (~0.48) and async pre-rot wrap-up (~0.38). */
const CONTEXT_COMPACT_RATIO = 0.48;
const CONTEXT_WRAP_UP_RATIO = 0.38;
const CACHE_READY_RATIO = 0.5;

type Colorize = (text: string) => string;

export interface ManagedUsageRow {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly resetHint?: string;
}

export interface ManagedUsageReport {
  readonly summary: ManagedUsageRow | null;
  readonly limits: readonly ManagedUsageRow[];
}

export interface UsageReportOptions {
  readonly sessionUsage?: SessionUsage;
  readonly sessionUsageError?: string;
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
}

export interface ManagedUsageReportLineOptions {
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
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

function buildManagedUsageSection(
  usage: ManagedUsageReport | undefined,
  error: string | undefined,
  accent: Colorize,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  if (error !== undefined) return [accent('Plan usage'), errorStyle(`  ${error}`)];
  if (usage === undefined) return [];
  const { summary, limits } = usage;
  if (summary === null && limits.length === 0) {
    return [accent('Plan usage'), muted('  No usage data available.')];
  }

  const rows: ManagedUsageRow[] = [];
  if (summary !== null) rows.push(summary);
  rows.push(...limits);
  const usedRatio = (r: ManagedUsageRow): number =>
    r.limit > 0 ? Math.max(0, Math.min(r.used / r.limit, 1)) : 0;
  const labelWidth = Math.max(10, ...rows.map((r) => r.label.length));
  const pctWidth = Math.max(...rows.map((r) => `${Math.round(usedRatio(r) * 100)}% used`.length));
  const severityColor = (sev: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' =>
    sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';
  const out: string[] = [accent('Plan usage')];
  for (const row of rows) {
    const ratioUsed = usedRatio(row);
    const pct = `${Math.round(ratioUsed * 100)}% used`;
    const barColor = severityColor(ratioSeverity(ratioUsed));
    const barColoured = renderRendererRatioProgressBar({
      ratio: ratioUsed,
      width: 20,
      filledStyle: (text) => currentTheme.fg(barColor, text),
      emptyStyle: (text) => currentTheme.fg(barColor, text),
    });
    const label = row.label.padEnd(labelWidth, ' ');
    const resetStr = row.resetHint ? `  ${muted(row.resetHint)}` : '';
    out.push(`  ${muted(label)}  ${barColoured}  ${value(pct.padEnd(pctWidth, ' '))}${resetStr}`);
  }
  return out;
}

export function buildManagedUsageReportLines(options: ManagedUsageReportLineOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);

  return buildManagedUsageSection(
    options.managedUsage,
    options.managedUsageError,
    accent,
    value,
    muted,
    errorStyle,
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
  });
  if (managedSection.length > 0) {
    lines.push('');
    lines.push(...managedSection);
  }

  return lines;
}

export class UsagePanelComponent implements Component {
  /** Cached coloured lines; rebuilt from `buildLines` on every invalidate. */
  private lines: readonly string[];

  constructor(
    private readonly buildLines: () => readonly string[],
    private readonly borderToken: ColorToken,
    private readonly title: string = ' Usage ',
  ) {
    this.lines = buildLines();
  }

  invalidate(): void {
    // Report bodies embed palette colours, so a theme switch must re-run the
    // builder to repaint the cached lines (the data itself is captured).
    this.lines = this.buildLines();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const paint = (s: string): string => currentTheme.fg(this.borderToken, s);
    const availableInterior = safeWidth - BOX_OVERHEAD;
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
    const title = fitRendererFrameTitle(this.title, horzLen, '…');
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
    return frame.map((line) => truncateToWidth(indent + line, safeWidth, '…'));
  }
}
