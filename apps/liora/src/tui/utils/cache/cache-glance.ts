import type { UsageStatus } from '@superliora/sdk';

import type { AppState } from '#/tui/types';

import {
  buildCacheMissDumpExportLines,
  formatCacheDiagnosticsLine,
  formatCacheMissReasonGlance,
  CACHE_MISS_REASON_STUB_TIP,
  type UsageCacheMissLike,
} from './cache-diagnostics';
import { CACHE_FREEZE_MID_TURN_TIP, formatCacheFreezeLine } from './cache-freeze-line';
import { formatCacheHitMeter, CACHE_HIT_TARGET, type CacheHitMeterResult } from './cache-hit-meter';

export interface CacheHitSources {
  readonly appStateCacheMeter?: AppState['cacheMeter'];
  readonly statusHitRate?: number;
  readonly statusWarmStreak?: number;
}

export type CacheGlanceTone = 'success' | 'warning' | 'muted';

export interface CacheStyledLine {
  readonly text: string;
  readonly tone?: CacheGlanceTone;
}

export interface CacheSessionGlance {
  readonly hitLine: string;
  readonly statusLine: CacheStyledLine;
  readonly prefixLine?: CacheStyledLine;
  readonly missReasonLine?: CacheStyledLine;
  readonly freezeLine?: CacheStyledLine;
  readonly showMissReasonStubTip: boolean;
  readonly hasLiveHitRate: boolean;
}

/** Session hit rate + streak from AppState when synced from agent.status.updated. */
export function resolveCacheHitFromAppState(
  cacheMeter: AppState['cacheMeter'],
): { readonly rate: number; readonly streak: number } | undefined {
  if (cacheMeter === undefined || cacheMeter === null) return undefined;
  if (!Number.isFinite(cacheMeter.rate)) return undefined;
  return {
    rate: cacheMeter.rate,
    streak: cacheMeter.streak ?? 0,
  };
}

/** Build AppState.cacheMeter from getStatus / agent.status.updated usage fields. */
export function cacheMeterFromHitRate(
  hitRate: number | undefined,
  warmStreak?: number,
): NonNullable<AppState['cacheMeter']> | undefined {
  if (typeof hitRate !== 'number' || !Number.isFinite(hitRate)) return undefined;
  return { rate: hitRate, streak: warmStreak ?? 0 };
}

/** Prefer live getStatus fields; fall back to AppState cacheMeter between refreshes. */
export function resolveCacheHitSources(sources: CacheHitSources): CacheHitMeterResult {
  const fromStatus =
    sources.statusHitRate !== undefined && Number.isFinite(sources.statusHitRate)
      ? formatCacheHitMeter(sources.statusHitRate, sources.statusWarmStreak)
      : null;
  if (fromStatus != null && sources.statusHitRate !== undefined) {
    return fromStatus;
  }

  const fromApp = resolveCacheHitFromAppState(sources.appStateCacheMeter);
  if (fromApp != null) {
    return formatCacheHitMeter(fromApp.rate, fromApp.streak);
  }

  return formatCacheHitMeter(undefined);
}

function toStyledDiagnosticsLine(
  line: { readonly line: string; readonly warn: boolean } | null,
): CacheStyledLine | undefined {
  if (line == null) return undefined;
  return {
    text: line.line,
    tone: line.warn ? 'warning' : 'muted',
  };
}

/** Live Session cache hit/streak/freeze from getStatus + AppState fallback. */
export function resolveCacheSessionGlance(input: {
  readonly appStateCacheMeter?: AppState['cacheMeter'];
  readonly statusHitRate?: number;
  readonly statusWarmStreak?: number;
  readonly cacheFrozen?: boolean;
  /** Loop22b: soft/hard freeze drift count. */
  readonly cacheFreezeViolations?: number;
  readonly usage?: UsageStatus;
}): CacheSessionGlance {
  const targetTip = `target ≥${String(Math.round(CACHE_HIT_TARGET * 100))}%`;
  const meter = resolveCacheHitSources({
    appStateCacheMeter: input.appStateCacheMeter,
    statusHitRate: input.statusHitRate,
    statusWarmStreak: input.statusWarmStreak,
  });

  const hasLiveHitRate =
    input.statusHitRate !== undefined && Number.isFinite(input.statusHitRate);

  let hitLine: string;
  if (meter.line === 'Cache hit: (no data yet)') {
    hitLine = `Session cache hit: (no data yet — run a few turns · ${targetTip})`;
  } else {
    hitLine = `Session ${meter.line.replace(/^Cache hit: /, 'cache hit: ')}`;
  }

  let statusLine: CacheStyledLine;
  if (!hasLiveHitRate && input.statusHitRate === undefined) {
    const fromApp = resolveCacheHitFromAppState(input.appStateCacheMeter);
    if (fromApp != null) {
      statusLine = meter.meetsTarget
        ? { text: 'Status: warm — cache prefix stable', tone: 'success' }
        : { text: 'Status: below target — check Cache Sacred rules', tone: 'warning' };
    } else {
      statusLine = { text: 'Status: waiting for usage data', tone: 'muted' };
    }
  } else if (input.statusHitRate === undefined) {
    statusLine = { text: 'Status: waiting for usage data', tone: 'muted' };
  } else {
    statusLine = meter.meetsTarget
      ? { text: 'Status: warm — cache prefix stable', tone: 'success' }
      : { text: 'Status: below target — check Cache Sacred rules', tone: 'warning' };
  }

  const prefixLine = toStyledDiagnosticsLine(
    formatCacheDiagnosticsLine(input.usage?.cacheDiagnostics),
  );
  const missReasonLine = toStyledDiagnosticsLine(formatCacheMissReasonGlance(input.usage));
  const showMissReasonStubTip = missReasonLine == null;

  const freezeText = formatCacheFreezeLine(
    input.cacheFrozen,
    input.cacheFreezeViolations,
  );
  const freezeLine: CacheStyledLine | undefined =
    freezeText != null
      ? {
          text: freezeText,
          tone:
            input.cacheFrozen === true ||
            (input.cacheFreezeViolations !== undefined && input.cacheFreezeViolations > 0)
              ? 'warning'
              : 'muted',
        }
      : undefined;

  return {
    hitLine,
    statusLine,
    ...(prefixLine != null ? { prefixLine } : {}),
    ...(missReasonLine != null ? { missReasonLine } : {}),
    ...(freezeLine != null ? { freezeLine } : {}),
    showMissReasonStubTip,
    hasLiveHitRate,
  };
}

/** Provider prompt_cache_key is session id (+ optional :vN epoch) — invalidate via Settings, /new, or model switch. */
export const CACHE_INVALIDATE_TIP =
  'Invalidate: Settings → Cache → Invalidate prompt cache, /new, or switch model — prompt_cache_key rotates on the next turn.';

export function nextCacheInvalidateEpoch(currentEpoch: number | undefined): number {
  return (currentEpoch ?? 0) + 1;
}

export function cacheInvalidateStatusMessage(epoch?: number): string {
  if (epoch !== undefined && epoch > 0) {
    return `Prompt cache invalidated (epoch v${String(epoch)}). Next turn uses a cold prefix.`;
  }
  return CACHE_INVALIDATE_TIP;
}

export interface BuildCacheSettingsLinesInput {
  readonly session: CacheSessionGlance;
  readonly usage?: UsageCacheMissLike | null;
  readonly cacheHitRate?: number | null;
  readonly cacheWarmStreak?: number | null;
  readonly cacheFrozen?: boolean | null;
  readonly cacheFreezeViolations?: number | null;
  readonly capturedAtIso?: string;
}

function isBuildCacheSettingsLinesInput(
  value: CacheSessionGlance | BuildCacheSettingsLinesInput,
): value is BuildCacheSettingsLinesInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'session' in value &&
    (value as BuildCacheSettingsLinesInput).session != null &&
    typeof (value as BuildCacheSettingsLinesInput).session.hitLine === 'string'
  );
}

export function buildCacheSettingsLines(
  sessionOrInput: CacheSessionGlance | BuildCacheSettingsLinesInput,
): readonly string[] {
  const input: BuildCacheSettingsLinesInput = isBuildCacheSettingsLinesInput(sessionOrInput)
    ? sessionOrInput
    : { session: sessionOrInput };
  const session = input.session;
  const targetTip = `target ≥${String(Math.round(CACHE_HIT_TARGET * 100))}%`;
  const dumpLines = buildCacheMissDumpExportLines({
    usage: input.usage,
    cacheHitRate: input.cacheHitRate,
    cacheWarmStreak: input.cacheWarmStreak,
    cacheFrozen: input.cacheFrozen,
    capturedAtIso: input.capturedAtIso,
  });

  return [
    '── Prompt cache ────────────────────────────',
    'Live session KPIs from getStatus (hit · streak · freeze).',
    '',
    '── Session (live) ───────────────────────────',
    session.hitLine,
    session.statusLine.text,
    ...(session.prefixLine != null ? [session.prefixLine.text] : []),
    ...(session.missReasonLine != null ? [session.missReasonLine.text] : []),
    ...(session.freezeLine != null ? [session.freezeLine.text] : []),
    '',
    ...dumpLines,
    '',
    '── Cache Sacred rules ──────────────────────',
    `· Target: ${targetTip} prompt cache hit (cache✓ badge in footer + /ops)`,
    `· ${CACHE_FREEZE_MID_TURN_TIP}`,
    '· Freeze policy: setActiveTools hard-blocked while frozen; step soft-check logs tool-list drift.',
    ...(session.showMissReasonStubTip ? [`· ${CACHE_MISS_REASON_STUB_TIP}`] : []),
    '· Do not mutate system / tool schemas mid-turn',
    '· Dynamic facts go at message tail only',
    '· CacheFreezeGuard freezes enabled-tool set at turn start (mid-turn setActiveTools rejected).',
    '· Prefer RepoQuery/index over re-injecting huge trees',
    '',
    '── Invalidate ───────────────────────────────',
    `· ${CACHE_INVALIDATE_TIP}`,
    '',
    'Ops: /ops shows live cache hit alongside Goal/MCP.',
    'Export: cache miss dump JSON (`superliora.cache_miss.v1`) ships in this panel.',
  ];
}
