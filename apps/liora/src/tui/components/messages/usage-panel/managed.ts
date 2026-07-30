import { renderRendererRatioProgressBar } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';

import {
  type Colorize,
  ratioSeverity,
  severityColorToken,
  shortAccountKey,
  usedRatio,
} from './helpers';
import type {
  ManagedAccountUsageReport,
  ManagedUsageReport,
  ManagedUsageReportLineOptions,
  ManagedUsageRow,
} from './types';

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
