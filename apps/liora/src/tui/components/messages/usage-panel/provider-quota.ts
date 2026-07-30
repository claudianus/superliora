import { renderRendererRatioProgressBar } from '#/tui/renderer';
import type { AllProvidersUsageSnapshot } from '@superliora/sdk';
import { currentTheme } from '#/tui/theme';

import { type Colorize, quotaRowRatio, ratioSeverity, severityColorToken } from './helpers';

export function buildProviderQuotaSection(
  quota: AllProvidersUsageSnapshot | null | undefined,
  accent: Colorize,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  if (quota === undefined || quota === null) return [];
  const providers = quota.providers;
  if (providers.length === 0) return [];

  const out: string[] = [accent('Provider quotas')];
  const labelWidth = Math.max(12, ...providers.map((p) => p.displayName.length));

  for (const snap of providers) {
    const name = snap.displayName.padEnd(labelWidth, ' ');
    if (snap.error !== undefined) {
      out.push(`  ${muted(name)}  ${errorStyle(snap.error)}`);
      continue;
    }
    if (!snap.available) {
      out.push(`  ${muted(name)}  ${muted('usage API not available')}`);
      continue;
    }
    const rows: {
      readonly label: string;
      readonly used: number;
      readonly limit: number;
      readonly resetHint?: string;
    }[] = [];
    if (snap.summary !== null) rows.push(snap.summary);
    rows.push(...snap.limits);
    if (rows.length === 0) {
      out.push(`  ${muted(name)}  ${muted('no usage data')}`);
      continue;
    }
    out.push(`  ${value(snap.displayName)}`);
    const rowLabelWidth = Math.max(10, ...rows.map((r) => r.label.length));
    for (const row of rows) {
      const ratio = quotaRowRatio(row);
      const pct = `${Math.round(ratio * 100)}% used`;
      const barColor = severityColorToken(ratioSeverity(ratio));
      const barColoured = renderRendererRatioProgressBar({
        ratio,
        width: 20,
        filledStyle: (text) => currentTheme.fg(barColor, text),
        emptyStyle: (text) => currentTheme.fg(barColor, text),
      });
      const label = row.label.padEnd(rowLabelWidth, ' ');
      const resetStr = row.resetHint ? `  ${muted(row.resetHint)}` : '';
      out.push(`    ${muted(label)}  ${barColoured}  ${value(pct)}${resetStr}`);
    }
  }
  return out;
}
