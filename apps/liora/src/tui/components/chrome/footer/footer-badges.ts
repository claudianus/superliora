import { currentTheme, type ColorToken } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import type { AllProvidersUsageSnapshot, ProviderUsageSnapshot } from '@superliora/sdk';
import { resolveUsageProviderKey, snapshotWorstRatio } from '@superliora/sdk';
import { renderPulseText } from '#/tui/features/appearance/appearance-effects';
import type { FooterLabels } from '#/tui/config';

import { safeContextUsage } from '#/tui/components/chrome/footer/footer-context';
import {
  isPlainLabels,
  labelCacheRate,
  labelCacheWarm,
} from '#/tui/components/chrome/footer/footer-labels';
import { formatCacheHitMeter } from '#/tui/utils/cache/cache-hit-meter';
import { resolveCacheHitFromAppState } from '#/tui/utils/cache/cache-glance';

export type FooterBadgeSeverity = 'muted' | 'info' | 'warning' | 'danger';

export interface FooterBadge {
  readonly text: string;
  readonly severity: FooterBadgeSeverity;
}

export function styleFooterBadge(
  badge: FooterBadge,
  appearance: AppState['appearance'] | undefined,
): string {
  if (badge.severity === 'danger') {
    return renderPulseText(badge.text, `footer:badge:${badge.text}`, 'error', appearance);
  }
  const token: ColorToken =
    badge.severity === 'warning'
      ? 'warning'
      : badge.severity === 'info'
        ? 'primary'
        : 'textMuted';
  return currentTheme.boldFg(token, badge.text);
}






/**
 * Session cost badge for the footer (`COST $0.42`). The header density
 * segment hides below 100 columns, so narrow/split terminals previously had
 * no persistent cost display at all — the footer badge keeps spend visible
 * where the header cannot.
 */
export function formatSessionCostFooterBadge(
  sessionCostUsd: number | undefined,
): FooterBadge | null {
  if (typeof sessionCostUsd !== 'number' || !(sessionCostUsd > 0)) return null;
  const usd =
    sessionCostUsd < 0.01
      ? `$${sessionCostUsd.toFixed(4)}`
      : sessionCostUsd < 1
        ? `$${sessionCostUsd.toFixed(3)}`
        : `$${sessionCostUsd.toFixed(2)}`;
  return { text: `COST ≈${usd}`, severity: 'muted' };
}

function pickActiveQuotaSnapshot(
  quota: AllProvidersUsageSnapshot,
  activeProviderKey: string | undefined,
): ProviderUsageSnapshot | undefined {
  if (activeProviderKey !== undefined && activeProviderKey.length > 0) {
    const want = resolveUsageProviderKey(activeProviderKey);
    const exact = quota.providers.find(
      (p) => resolveUsageProviderKey(p.providerKey) === want,
    );
    if (exact !== undefined) return exact;
  }
  if (quota.primaryProviderKey !== null) {
    return quota.providers.find((p) => p.providerKey === quota.primaryProviderKey);
  }
  // No active provider identity: hide the chip rather than show some other
  // provider's remaining quota (PREMIUM §8 — active provider only).
  return undefined;
}

function worstRatioSeverity(ratio: number): FooterBadgeSeverity {
  if (ratio >= 0.9) return 'danger';
  if (ratio >= 0.7) return 'warning';
  return 'info';
}

/**
 * Footer chip for the ACTIVE provider remaining quota.
 * Severity still uses worstRatio (≥90% danger, ≥70% warning).
 * Hidden when remaining is unknown — never a fabricated 0%/100%.
 */
export function formatProviderQuotaFooterBadge(
  quota: AllProvidersUsageSnapshot | null | undefined,
  labels: FooterLabels = 'plain',
  activeProviderKey?: string,
): FooterBadge | null {
  if (quota === undefined || quota === null) return null;
  const snap = pickActiveQuotaSnapshot(quota, activeProviderKey);
  if (snap === undefined) return null;
  if (!snap.available || snap.error !== undefined) return null;
  const text = (snap.remainingDisplay ?? '').trim();
  if (text.length === 0) return null;
  const compact = !isPlainLabels(labels);
  return {
    text: compact && text.length > 18 ? text.replace(/\s·\s/, ' ') : text,
    severity: worstRatioSeverity(snapshotWorstRatio(snap)),
  };
}


/** Prompt-cache warm-streak badge — SSOT: AppState.cacheMeter via resolveCacheHitFromAppState. */
export function formatCacheHitFooterBadge(
  cacheMeter: AppState['cacheMeter'],
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  const hit = resolveCacheHitFromAppState(cacheMeter);
  if (hit == null) return null;
  const meter = formatCacheHitMeter(hit.rate, hit.streak);
  if (meter.footerBadge === null) return null;
  const streak =
    hit.streak !== undefined && hit.streak >= 3 ? `×${String(hit.streak)}` : '';
  if (meter.meetsTarget) {
    return { text: labelCacheWarm(labels, streak), severity: 'info' };
  }
  const pct = Math.round(hit.rate * 100);
  return { text: labelCacheRate(labels, pct), severity: 'warning' };
}

/** Context usage line severity aligned with soft/hard reclaim ladder. */
export function contextUsageSeverity(usage: number): FooterBadgeSeverity {
  const ratio = safeContextUsage(usage);
  if (ratio >= 0.95) return 'danger';
  // Ladder: async 0.55 · soft 0.70 · hard 0.90.
  // Soft → info (reclaim soon); hard → warning (stop before overflow); ≥0.95 → danger.
  if (ratio >= 0.90) return 'warning';
  if (ratio >= 0.70) return 'info';
  return 'muted';
}
