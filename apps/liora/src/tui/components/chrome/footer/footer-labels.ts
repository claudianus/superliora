/**
 * Human-readable status-bar labels — plain (default) vs compact.
 */

import type { FooterLabels } from '#/tui/config';
import { formatTokenCount } from '#/tui/utils/agent/context-working-set';

export function isPlainLabels(labels: FooterLabels): boolean {
  return labels !== 'compact';
}

export function labelModeYolo(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'YOLO' : 'yolo';
}

export function labelModeAuto(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Auto' : 'auto';
}

export function labelModePlan(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Plan' : 'plan';
}

export function labelModeAsk(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Ask' : 'ask';
}

export function labelModePremium(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Premium' : 'premium';
}

export function labelCompact(labels: FooterLabels, background: boolean): string {
  if (isPlainLabels(labels)) {
    return background ? 'Compacting…' : 'Compacting';
  }
  return background ? 'compact-bg' : 'compact';
}

export function labelPromptIntel(labels: FooterLabels, phase: 'inline' | 'suggest'): string {
  if (isPlainLabels(labels)) {
    return phase === 'inline' ? 'Completing…' : 'Suggesting…';
  }
  return phase === 'inline' ? 'ghost…' : 'suggest…';
}

export function labelMedia(
  labels: FooterLabels,
  image: boolean,
  video: boolean,
): string {
  if (isPlainLabels(labels)) {
    if (image && video) return 'Media ready';
    if (image) return 'Images ready';
    return 'Video ready';
  }
  if (image && video) return 'img·vid';
  if (image) return 'img';
  return 'vid';
}

export function labelHistoryViewport(labels: FooterLabels, rowsBehind: number, compactCount: string): string {
  if (isPlainLabels(labels)) {
    return `History · ${compactCount} lines up`;
  }
  return `history +${compactCount} rows`;
}

export function labelGoalXp(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Goal +' : 'xp';
}

export function labelFleetDone(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Worker done' : 'done';
}

export function labelPermissionOk(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Approved' : 'perm✓';
}

export function labelGitChurn(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Files changed' : 'diff↑';
}

export function labelOpsCombo(labels: FooterLabels, score: number): string {
  return isPlainLabels(labels) ? 'On a roll' : `combo×${String(score)}`;
}

export function labelExtensionsReload(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Extensions reloaded' : 'ext↻';
}

export function labelRuntimeDegraded(labels: FooterLabels, scope: string): string {
  const s = scope.trim().length > 0 ? scope : 'runtime';
  if (isPlainLabels(labels)) {
    if (s === 'search') return 'Search issue';
    if (s === 'oauth') return 'Auth issue';
    if (s === 'llm') return 'Model issue';
    return `${s} issue`;
  }
  return s === 'search' ? 'search↓' : `${s}↓`;
}

export function labelMcp(
  labels: FooterLabels,
  kind: 'error' | 'auth' | 'ok',
): string {
  if (isPlainLabels(labels)) {
    if (kind === 'error') return 'MCP error';
    if (kind === 'auth') return 'MCP needs login';
    return 'MCP ok';
  }
  if (kind === 'error') return 'mcp!';
  if (kind === 'auth') return 'mcp?';
  return 'mcp';
}

export function labelCacheWarm(labels: FooterLabels, streakSpark: string): string {
  if (isPlainLabels(labels)) {
    return streakSpark.length > 0 ? `Cache warm ${streakSpark}` : 'Cache warm';
  }
  return `cache✓${streakSpark}`;
}

export function labelCacheRate(labels: FooterLabels, pct: number): string {
  return isPlainLabels(labels) ? `Cache ${String(pct)}%` : `cache ${String(pct)}%`;
}

export function labelIndex(
  labels: FooterLabels,
  kind: 'warm' | 'cold' | 'off' | 'stub',
): string {
  if (isPlainLabels(labels)) {
    if (kind === 'warm') return 'Index ready';
    if (kind === 'cold') return 'Index cold';
    if (kind === 'stub') return 'Index off';
    return 'Index off';
  }
  if (kind === 'warm') return 'idx·warm';
  if (kind === 'cold') return 'idx·cold';
  if (kind === 'stub') return 'idx·stub-off';
  return 'idx·off';
}

export function labelSearchCascade(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Research active' : 'research↻';
}

export function labelWorkingSet(
  labels: FooterLabels,
  snapshot: { maxWorkingSetTokens: number; presetId?: string },
): string | null {
  if (snapshot.maxWorkingSetTokens <= 0) {
    if (snapshot.presetId === 'full_window') {
      return isPlainLabels(labels) ? 'Working set full' : 'ws:full';
    }
    return isPlainLabels(labels) ? 'Working set off' : 'ws:off';
  }
  const size = formatTokenCount(snapshot.maxWorkingSetTokens);
  return isPlainLabels(labels) ? `Working set ${size}` : `ws:${size}`;
}

export function labelQuota(labels: FooterLabels, pct: number): string {
  return isPlainLabels(labels) ? `Quota ${String(pct)}%` : `quota ${String(pct)}%`;
}

export function labelBackgroundBash(labels: FooterLabels, count: number): string {
  if (isPlainLabels(labels)) {
    return count === 1 ? '1 shell job' : `${String(count)} shell jobs`;
  }
  const noun = count === 1 ? 'task' : 'tasks';
  return `[${String(count)} ${noun} running]`;
}

export function labelBackgroundAgent(labels: FooterLabels, count: number): string {
  if (isPlainLabels(labels)) {
    return count === 1 ? '1 agent' : `${String(count)} agents`;
  }
  const noun = count === 1 ? 'agent' : 'agents';
  return `[${String(count)} ${noun} running]`;
}

/** Compact Conductor Job strip for footer (E1). */
export function labelConductorJobs(
  labels: FooterLabels,
  snap: {
    readonly running: number;
    readonly queued: number;
    readonly blocked: number;
    readonly needsUser: number;
    readonly interrupted: number;
    readonly failed: number;
    readonly unreadInbox: number;
    readonly maxConcurrent?: number;
  },
  extras?: {
    readonly projectMode?: string;
    /** Optional session token glance when running jobs expose usage. */
    readonly tokenGlance?: string;
  },
): string {
  const parts: string[] = [];
  const mode = extras?.projectMode;
  const pool =
    snap.maxConcurrent !== undefined ? `pool=${String(snap.maxConcurrent)}` : undefined;
  const tok = extras?.tokenGlance;
  if (isPlainLabels(labels)) {
    if (mode !== undefined) parts.push(`mode=${mode}`);
    if (pool !== undefined) parts.push(pool);
    if (snap.running > 0) parts.push(`${String(snap.running)} running`);
    if (tok !== undefined) parts.push(tok);
    if (snap.queued > 0) parts.push(`${String(snap.queued)} queued`);
    if (snap.blocked > 0) parts.push(`${String(snap.blocked)} blocked`);
    if (snap.needsUser > 0) parts.push(`${String(snap.needsUser)} need you`);
    if (snap.interrupted > 0) parts.push(`${String(snap.interrupted)} paused`);
    if (snap.failed > 0) parts.push(`${String(snap.failed)} failed`);
    if (snap.unreadInbox > 0) parts.push(`${String(snap.unreadInbox)} inbox`);
    if (parts.length === 0) return 'Jobs idle';
    return `Jobs · ${parts.join(' · ')}`;
  }
  if (mode !== undefined) parts.push(`m=${mode}`);
  if (pool !== undefined) parts.push(pool);
  if (snap.running > 0) parts.push(`${String(snap.running)}▸`);
  if (tok !== undefined) parts.push(tok.replace(/\s/g, ''));
  if (snap.queued > 0) parts.push(`${String(snap.queued)}…`);
  if (snap.blocked > 0) parts.push(`${String(snap.blocked)}⛔`);
  if (snap.needsUser > 0) parts.push(`${String(snap.needsUser)}?`);
  if (snap.interrupted > 0) parts.push(`${String(snap.interrupted)}⏸`);
  if (snap.failed > 0) parts.push(`${String(snap.failed)}✗`);
  if (snap.unreadInbox > 0) parts.push(`i${String(snap.unreadInbox)}`);
  if (parts.length === 0) return 'jobs';
  return `jobs:${parts.join(' ')}`;
}

export function labelModelRoute(
  labels: FooterLabels,
  kind: 'failover' | 'compact' | 'complete' | 'cred' | 'via',
  fromLabel: string | undefined,
  toLabel: string,
): string {
  if (isPlainLabels(labels)) {
    if (kind === 'failover' && fromLabel !== undefined) {
      return `Failover · ${fromLabel} → ${toLabel}`;
    }
    if (kind === 'compact') return `Compact model · ${toLabel}`;
    if (kind === 'complete') return `Completing with ${toLabel}`;
    if (kind === 'cred') return `Credentials · ${toLabel}`;
    return `via ${toLabel}`;
  }
  if (kind === 'failover' && fromLabel !== undefined) {
    return `failover ${fromLabel}→${toLabel}`;
  }
  if (kind === 'compact') return `compact ${toLabel}`;
  if (kind === 'complete') return `complete ${toLabel}`;
  if (kind === 'cred') return `cred ${toLabel}`;
  return `via ${toLabel}`;
}

export function labelMenu(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Menu ?' : 'Menu ?';
}

export function labelContextPrefix(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Context' : 'context';
}
