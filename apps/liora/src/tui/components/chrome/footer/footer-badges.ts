import { currentTheme, type ColorToken } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import type { AllProvidersUsageSnapshot } from '@superliora/sdk';
import { renderPulseText } from '#/tui/features/appearance/appearance-effects';
import { workingSetPressure } from '#/tui/utils/agent/context-working-set';
import type { FooterLabels } from '#/tui/config';

import { safeContextUsage } from '#/tui/components/chrome/footer/footer-context';
import {
  labelCacheRate,
  labelCacheWarm,
  labelExtensionsReload,
  labelMedia,
  labelMcp,
  labelQuota,
  labelRuntimeDegraded,
  labelWorkingSet,
} from '#/tui/components/chrome/footer/footer-labels';
import { formatCacheHitMeter } from '#/tui/utils/cache/cache-hit-meter';
import { resolveCacheHitFromAppState } from '#/tui/utils/cache/cache-glance';
import {
  isRuntimeDegradedActive,
  RUNTIME_DEGRADED_BADGE_TTL_MS,
  staleRuntimeDegradedClearPatch,
} from '#/tui/utils/never-halt/runtime-degraded';
import { staleSearchCascadeClearPatch } from '#/tui/utils/search/search-cascade';

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

export { RUNTIME_DEGRADED_BADGE_TTL_MS };
export const EXTENSIONS_RELOAD_BADGE_TTL_MS = 45_000;

export { formatSearchCascadeFooterBadge } from '#/tui/utils/search/search-cascade';

/** True while extensions reload snapshot is within the footer TTL window. */
export function isExtensionsReloadActive(
  reload: AppState['extensionsReload'],
  nowMs: number = Date.now(),
): reload is NonNullable<AppState['extensionsReload']> {
  if (reload === undefined || reload === null) return false;
  return nowMs - reload.atMs < EXTENSIONS_RELOAD_BADGE_TTL_MS;
}

/** Patch to clear expired extensionsReload from AppState; null when no update needed. */
export function staleExtensionsReloadClearPatch(
  reload: AppState['extensionsReload'],
  nowMs: number = Date.now(),
): Pick<AppState, 'extensionsReload'> | null {
  if (reload === undefined || reload === null) return null;
  if (isExtensionsReloadActive(reload, nowMs)) return null;
  return { extensionsReload: null };
}

/** Drop expired TTL footer glance fields from AppState. */
export function collectFooterStaleAppStatePatches(
  state: Pick<AppState, 'runtimeDegraded' | 'searchCascade' | 'extensionsReload'>,
  nowMs: number = Date.now(),
): Partial<AppState> {
  const patch: Partial<AppState> = {};
  const degraded = staleRuntimeDegradedClearPatch(state.runtimeDegraded, nowMs);
  if (degraded !== null) Object.assign(patch, degraded);
  const cascade = staleSearchCascadeClearPatch(state.searchCascade, nowMs);
  if (cascade !== null) Object.assign(patch, cascade);
  const extensionsReload = staleExtensionsReloadClearPatch(state.extensionsReload, nowMs);
  if (extensionsReload !== null) Object.assign(patch, extensionsReload);
  return patch;
}

/** Patch for setAppState after a successful extensions hot-reload. */
export function extensionsReloadAppStatePatch(
  nowMs: number = Date.now(),
): Pick<AppState, 'extensionsReload'> {
  return { extensionsReload: { atMs: nowMs } };
}

/** Extensions hot-reload badge (MCP/skills/import) — ~45s TTL. */
export function formatExtensionsReloadFooterBadge(
  reload: AppState['extensionsReload'],
  nowMs: number = Date.now(),
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  if (!isExtensionsReloadActive(reload, nowMs)) return null;
  return { text: labelExtensionsReload(labels), severity: 'info' };
}

/** Never-Halt search/runtime degraded badge (Ops glance). */
export function formatRuntimeDegradedFooterBadge(
  degraded: AppState['runtimeDegraded'],
  nowMs: number = Date.now(),
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  if (!isRuntimeDegradedActive(degraded, nowMs)) return null;
  const scope = degraded.scope.trim().length > 0 ? degraded.scope : 'runtime';
  const severity: FooterBadgeSeverity =
    scope === 'oauth' || scope === 'llm' ? 'danger' : 'warning';
  return {
    text: labelRuntimeDegraded(labels, scope),
    severity,
  };
}

/** MCP health badge when any server failed / needs auth (Ops glance). */
export function formatMcpHealthFooterBadge(
  summary: AppState['mcpServersSummary'],
  labels: FooterLabels = 'plain',
  /** auto: hide healthy "ok"; always: include ok */
  includeOk: boolean = false,
): FooterBadge | null {
  if (summary === undefined || summary === null || summary.trim().length === 0) return null;
  const lower = summary.toLowerCase();
  if (lower.includes('fail') || lower.includes('error')) {
    return { text: labelMcp(labels, 'error'), severity: 'danger' };
  }
  if (lower.includes('auth') || lower.includes('need')) {
    return { text: labelMcp(labels, 'auth'), severity: 'warning' };
  }
  if (includeOk && (lower.includes('connected') || lower.includes('ok'))) {
    return { text: labelMcp(labels, 'ok'), severity: 'info' };
  }
  return null;
}


/**
 * Soft working-set badge, e.g. `ws:256k`. Shows the agent live-history cap
 * (not the full model window) so large-context models stay glanceable.
 */
export function formatWorkingSetFooterBadge(
  workingSet: AppState['workingSet'],
  contextTokens: number,
  maxContextTokens: number,
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  if (workingSet === undefined || workingSet === null) return null;
  const text = labelWorkingSet(labels, workingSet);
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
  labels: FooterLabels = 'plain',
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
    text: labelQuota(labels, pct),
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
  labels: FooterLabels = 'plain',
): { readonly label: string; readonly severity: FooterBadgeSeverity } | null {
  const image = mediaImageKeyReady(env);
  const video = mediaVideoKeyReady(env);
  if (!image && !video) return null;
  return { label: labelMedia(labels, image, video), severity: 'info' };
}

export { formatIndexFooterBadge } from '#/tui/utils/index/index-footer-badge';

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
