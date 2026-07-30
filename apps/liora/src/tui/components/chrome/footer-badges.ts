import { currentTheme, type ColorToken } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import type { AllProvidersUsageSnapshot } from '@superliora/sdk';
import { renderPulseText } from '#/tui/features/appearance/appearance-effects';
import {
  formatWorkingSetFooterBadgeText,
  workingSetPressure,
} from '#/tui/utils/agent/context-working-set';

import { safeContextUsage } from '#/tui/components/chrome/footer-context';

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

/** Evidence-missing badge for Context OS continuity (T4 durable IDs). */
export function formatContextOSFooterBadge(
  contextOS: AppState['contextOS'],
): FooterBadge | null {
  if (contextOS === undefined || contextOS === null || contextOS.pageCount <= 0) {
    return null;
  }
  if (contextOS.missingEvidencePageCount > 0) {
    return {
      text: `ctx-os:evidence↓${contextOS.evidenceIdRecallScore.toFixed(2)}`,
      severity: 'danger',
    };
  }
  if (contextOS.latestContinuityStatus !== 'ready') {
    return {
      text: `ctx-os:${contextOS.latestContinuityStatus}`,
      severity: 'warning',
    };
  }
  return null;
}

/** Micro tool-result clearing badge (primary cheap context path). */
export function formatMicroCompactionFooterBadge(
  micro: AppState['microCompaction'],
): FooterBadge | null {
  if (micro === undefined || micro === null || micro.total <= 0) return null;
  const last = micro.lastTrigger ?? 'micro';
  const severity: FooterBadgeSeverity =
    last === 'swarm_pressure' || last === 'usage_and_cache_miss' ? 'warning' : 'info';
  const short =
    last === 'usage_and_cache_miss'
      ? 'cache-miss'
      : last === 'swarm_pressure'
        ? 'swarm'
        : last;
  return {
    text: `μ:${short}×${String(micro.total)}`,
    severity,
  };
}

/**
 * Soft working-set badge, e.g. `ws:256k`. Shows the agent live-history cap
 * (not the full model window) so large-context models stay glanceable.
 */
export function formatWorkingSetFooterBadge(
  workingSet: AppState['workingSet'],
  contextTokens: number,
  maxContextTokens: number,
): FooterBadge | null {
  if (workingSet === undefined || workingSet === null) return null;
  const text = formatWorkingSetFooterBadgeText(workingSet);
  if (text === null) return null;
  const pressure = workingSetPressure({
    contextTokens,
    maxContextTokens,
    maxWorkingSetTokens: workingSet.maxWorkingSetTokens,
  });
  const severity: FooterBadgeSeverity =
    pressure === 'danger' ? 'danger' : pressure === 'warn' ? 'warning' : 'info';
  return { text, severity };
}

/**
 * Provider quota badge for the footer. Shows the worst usage ratio across
 * all configured providers as a compact `[quota 72%]` badge. Only rendered
 * when at least one provider exposes a queryable usage API and the ratio
 * is above zero.
 */
export function formatProviderQuotaFooterBadge(
  quota: AllProvidersUsageSnapshot | null | undefined,
): FooterBadge | null {
  if (quota === undefined || quota === null) return null;
  // Only show when at least one provider has queryable usage data.
  const hasQueryable = quota.providers.some((p) => p.available && p.error === undefined);
  if (!hasQueryable) return null;
  const ratio = quota.worstRatio;
  if (ratio <= 0) return null;
  const pct = Math.round(ratio * 100);
  const severity: FooterBadgeSeverity =
    ratio >= 0.90 ? 'danger' : ratio >= 0.70 ? 'warning' : 'info';
  return {
    text: `quota ${String(pct)}%`,
    severity,
  };
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when a zero-config image provider key is present in the process env. */
export function mediaImageKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['OPENAI_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

/** True when a zero-config video provider key is present (Google/Gemini). */
export function mediaVideoKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

/** True when any zero-config media key is present. */
export function mediaProviderKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return mediaImageKeyReady(env) || mediaVideoKeyReady(env);
}

/** Compact footer badge for beginner-visible media readiness (no MCP). */
export function formatMediaFooterBadge(
  env: NodeJS.ProcessEnv = process.env,
): { readonly label: string; readonly severity: FooterBadgeSeverity } | null {
  const image = mediaImageKeyReady(env);
  const video = mediaVideoKeyReady(env);
  if (!image && !video) return null;
  // Beginner-readable dense badges: modalities that are zero-config ready (no MCP).
  if (image && video) return { label: 'img·vid', severity: 'info' };
  if (image) return { label: 'img', severity: 'info' };
  return { label: 'vid', severity: 'info' };
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
