import { renderRendererRatioProgressBar } from '#/tui/renderer';
import type { AllProvidersUsageSnapshot, ProviderUsageSnapshot } from '@superliora/sdk';
import { snapshotRemainingRatio } from '@superliora/sdk';
import { currentTheme } from '#/tui/theme';

import { type Colorize, quotaRowRatio, ratioSeverity, severityColorToken, shortAccountKey } from './helpers';

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

function planChip(snap: ProviderUsageSnapshot): string {
  const plan = snap.plan?.trim();
  return plan !== undefined && plan.length > 0 ? plan : '';
}

function accountName(snap: ProviderUsageSnapshot, fallback: string): string {
  const label = snap.accountLabel?.trim();
  if (label !== undefined && label.length > 0) return label;
  const key = snap.accountKey?.trim();
  if (key !== undefined && key.length > 0) return shortAccountKey(key);
  return fallback;
}

/** Rows as `[label, bar, pct, reset]` lines, one per quota row. */
function quotaRowLines(
  snap: ProviderUsageSnapshot,
  indent: string,
  value: Colorize,
  muted: Colorize,
): string[] {
  const rows: { readonly label: string; readonly used: number; readonly limit: number; readonly resetHint?: string }[] = [];
  if (snap.summary !== null) rows.push(snap.summary);
  rows.push(...snap.limits);
  if (rows.length === 0) return [`${indent}${muted('no usage data')}`];
  const labelWidth = Math.max(10, ...rows.map((row) => row.label.length));
  const lines: string[] = [];
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
    const label = row.label.padEnd(labelWidth, ' ');
    const resetStr = row.resetHint !== undefined ? `  ${muted(row.resetHint)}` : '';
    lines.push(`${indent}${muted(label)}  ${barColoured}  ${value(pct)}${resetStr}`);
  }
  return lines;
}

function renderFlatProvider(
  snap: ProviderUsageSnapshot,
  labelWidth: number,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  const out: string[] = [];
  const name = snap.displayName.padEnd(labelWidth, ' ');
  const metaChips: string[] = [];
  const plan = planChip(snap);
  if (plan.length > 0) metaChips.push(plan);
  if (snap.accountLabel !== undefined) metaChips.push(snap.accountLabel);
  const metaSuffix = metaChips.length > 0 ? muted(`  ${metaChips.join(' · ')}`) : '';
  if (snap.error !== undefined) {
    out.push(`  ${muted(name)}${metaSuffix}  ${errorStyle(snap.error)}`);
    out.push(`    ${muted(sourceLabel(snap.source))} · ${muted(formatFetchedAt(snap.fetchedAtMs))}`);
    return out;
  }
  if (!snap.available) {
    out.push(`  ${muted(name)}${metaSuffix}  ${muted('usage API not available')}`);
    return out;
  }
  const remain = remainingLine(snap);
  out.push(`  ${value(name)}${metaSuffix}${remain.length > 0 ? muted(`  ${remain}`) : ''}`);
  const meta = [sourceLabel(snap.source), formatFetchedAt(snap.fetchedAtMs)].filter(
    (part) => part.length > 0,
  );
  if (meta.length > 0) out.push(`    ${muted(meta.join(' · '))}`);
  out.push(...quotaRowLines(snap, '    ', value, muted));
  return out;
}

function renderAccountGroup(
  snaps: readonly ProviderUsageSnapshot[],
  accent: Colorize,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  const displayName = snaps[0]?.displayName ?? snaps[0]?.providerKey ?? 'Provider';
  const out: string[] = [accent(`  ${displayName}`)];
  const labelWidth = Math.max(
    10,
    ...snaps.map((snap) => accountName(snap, snap.displayName).length),
  );
  for (const snap of snaps) {
    const name = accountName(snap, snap.displayName).padEnd(labelWidth, ' ');
    if (snap.error !== undefined) {
      out.push(`    ${errorStyle(name)}  ${errorStyle(snap.error)}`);
      continue;
    }
    if (!snap.available) {
      out.push(`    ${muted(name)}  ${muted('usage API not available')}`);
      continue;
    }
    const chips: string[] = [];
    const plan = planChip(snap);
    if (plan.length > 0) chips.push(plan);
    if (snap.isPrimary === true) chips.push('primary');
    const title = `    ${value(name)}${chips.length > 0 ? muted(`  ${chips.join(' · ')}`) : ''}`;
    const remain = remainingLine(snap);
    out.push(remain.length > 0 ? `${title}${muted(`  ${remain}`)}` : title);
    const meta = [sourceLabel(snap.source), formatFetchedAt(snap.fetchedAtMs)].filter(
      (part) => part.length > 0,
    );
    if (meta.length > 0) out.push(`      ${muted(meta.join(' · '))}`);
    out.push(...quotaRowLines(snap, '      ', value, muted));
  }
  return out;
}

/**
 * Provider quota section for `/quota` (and the footer-driven usage panel).
 *
 * Multi-account subscription pools (ChatGPT/Codex, xAI Grok, …) render one
 * block per account — label · plan · primary, then that account's windows —
 * mirroring the account-pool quota dashboard of opencodex. Providers without
 * pool metadata keep the compact flat layout.
 */
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

  // Pool fan-out snapshots are emitted adjacently per provider key. Group by
  // key so account blocks never interleave with other providers.
  const groups = new Map<string, ProviderUsageSnapshot[]>();
  for (const snap of providers) {
    const bucket = groups.get(snap.providerKey);
    if (bucket === undefined) groups.set(snap.providerKey, [snap]);
    else bucket.push(snap);
  }

  const flatWidth = Math.max(12, ...providers.map((snap) => snap.displayName.length));
  for (const snaps of groups.values()) {
    const needsAccounts =
      snaps.length > 1 ||
      snaps.some(
        (snap) =>
          snap.accountLabel !== undefined ||
          snap.accountKey !== undefined ||
          snap.isPrimary !== undefined ||
          planChip(snap).length > 0,
      );
    if (needsAccounts) {
      out.push(...renderAccountGroup(snaps, accent, value, muted, errorStyle));
    } else {
      for (const snap of snaps) {
        out.push(...renderFlatProvider(snap, flatWidth, value, muted, errorStyle));
      }
    }
  }
  out.push('');
  out.push(muted('Run /quota again to refresh · headers update after each reply'));
  return out;
}
