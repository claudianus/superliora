import { renderRendererRatioProgressBar } from '#/tui/renderer';
import type { AllProvidersUsageSnapshot, ProviderUsageSnapshot } from '@superliora/sdk';
import { snapshotRemainingRatio } from '@superliora/sdk';
import { currentTheme } from '#/tui/theme';

import { type Colorize, quotaRowRatio, ratioSeverity, severityColorToken } from './helpers';

function sourceLabel(source: ProviderUsageSnapshot['source']): string {
  if (source === 'oauth-api') return 'usage API';
  if (source === 'response-headers') return 'last-response headers';
  if (source === 'local-history') return 'this session (estimate)';
  if (source === 'catalog-pricing') return 'catalog pricing (estimate)';
  return 'unknown';
}

function formatFetchedAt(fetchedAtMs: number): string {
  if (!(fetchedAtMs > 0)) return '';
  const delta = Date.now() - fetchedAtMs;
  if (delta < 15_000) return 'just now';
  if (delta < 60_000) return `${String(Math.max(1, Math.round(delta / 1000)))}s ago`;
  if (delta < 3_600_000) return `${String(Math.max(1, Math.round(delta / 60_000)))}m ago`;
  return `${String(Math.max(1, Math.round(delta / 3_600_000)))}h ago`;
}

function remainingLine(snap: ProviderUsageSnapshot): string {
  const text = (snap.remainingDisplay ?? '').trim();
  if (text.length > 0) return text;
  const remaining = snapshotRemainingRatio(snap);
  if (remaining === undefined) return '';
  return `${String(Math.round(remaining * 100))}% left`;
}

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
      out.push(`    ${muted(sourceLabel(snap.source))} · ${muted(formatFetchedAt(snap.fetchedAtMs))}`);
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
    const remain = remainingLine(snap);
    out.push(`  ${value(snap.displayName)}${remain.length > 0 ? muted(`  ${remain}`) : ''}`);
    const meta = [sourceLabel(snap.source), formatFetchedAt(snap.fetchedAtMs)].filter(
      (part) => part.length > 0,
    );
    if (meta.length > 0) out.push(`    ${muted(meta.join(' · '))}`);
    const rowLabelWidth = Math.max(10, ...rows.map((r) => r.label.length));
    for (const row of rows) {
      const ratio = quotaRowRatio(row);
      const remaining = row.limit > 0 ? Math.max(0, 1 - ratio) : undefined;
      const pct =
        remaining !== undefined
          ? `${String(Math.round(remaining * 100))}% left`
          : `${String(Math.round(ratio * 100))}% used`;
      const barColor = severityColorToken(
        remaining !== undefined
          ? remaining < 0.1
            ? 'danger'
            : remaining < 0.25
              ? 'warn'
              : 'ok'
          : ratioSeverity(ratio),
      );
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
  out.push('');
  out.push(muted('Run /quota again to refresh · headers update after each reply'));
  return out;
}
