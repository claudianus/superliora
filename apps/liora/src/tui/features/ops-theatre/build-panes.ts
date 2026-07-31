/**
 * Pure pane builders for Ops Theatre — plain DTOs, no SlashCommandHost coupling.
 */

import type { PermissionMode } from '@superliora/sdk';

import {
  formatSearchCascadeOpsFallbackLine,
} from '../../utils/search/search-cascade';
import { formatOpsPermissionLine } from '../../utils/never-halt/auth-glance';

import {
  OPS_FLEET_BUDGET_TIP,
  OPS_FLEET_COST_GUARD_TIP,
  OPS_FLEET_EVIDENCE_TIP,
  formatFleetMakerCheckerSoftLiveLine,
  formatFleetParallelToolsOpsLine,
  type FleetParallelToolsGlance,
} from '../../utils/fleet/fleet-glance';
import {
  formatInterventionAutoExpireOpsHint,
  formatInterventionQueueOpsLine,
} from '../../utils/never-halt/intervention-glance';
import {
  formatGoalSoftAdvisoryOpsDisplayLine,
} from '../../utils/goal/goal-soft-advisory-glance';
import {
  formatGoalXpOpsLine,
  type GoalXpOpsGlance,
} from '../../utils/goal/goal-glance';
import {
  formatMissionRunLine,
  type MissionRunGlance,
} from '../../utils/mission/mission-glance';

import type { OpsTheatreGridPanes } from './layout';

export interface OpsTheatreGoalData {
  readonly status: string;
  readonly objective: string;
  readonly xpGlance?: GoalXpOpsGlance | null;
}

export interface OpsTheatreGitData {
  readonly branch: string;
  readonly dirty: boolean;
  /** Full porcelain changed-file count from git status SSOT (not preview cap). */
  readonly changedFileCount: number;
  readonly diffAdded: number;
  readonly diffDeleted: number;
  readonly ahead: number;
  readonly behind: number;
  readonly changedFiles?: readonly string[];
  /** Short unified-diff hunk preview (+/− lines only), frame-budget capped. */
  readonly diffSnippet?: readonly string[];
  /** Delta vs previous Ops tick when churn spark fired. */
  readonly churnDelta?: number;
}

export interface OpsTheatreDegradedData {
  readonly scope: string;
  readonly reason: string;
  readonly hint?: string;
}

export interface OpsTheatreSearchData {
  readonly configured: readonly string[];
  readonly searchDegraded: boolean;
  readonly lateChannelSuffix: string;
  readonly cascadeLine: string | null;
  readonly researchHopsLine: string | null;
  /** W13 live counters from session usage.searchNeverEmpty when wired. */
  readonly neverEmptyTelemetryLine?: string | null;
  /** W13 live hit/miss from session usage.localResearchCache when wired. */
  readonly localResearchCacheHitLine?: string | null;
}

export interface OpsTheatreFleetWorker {
  readonly name: string;
  readonly status: 'idle' | 'running';
}

/** Max +/− diff body lines shown in the Ops Git pane (frame budget). */
export const OPS_GIT_DIFF_SNIPPET_MAX_LINES = 4;

export interface OpsGitDiffSnippetLine {
  readonly kind: 'add' | 'delete' | 'context';
  readonly code: string;
}

/** Compact unified-diff preview for Ops Theatre — skips context rows. */
export function formatOpsGitDiffSnippetLines(
  lines: readonly OpsGitDiffSnippetLine[],
  maxLines: number = OPS_GIT_DIFF_SNIPPET_MAX_LINES,
): readonly string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind === 'context') continue;
    if (out.length >= maxLines) break;
    const prefix = line.kind === 'add' ? '+' : '−';
    out.push(truncate(`${prefix}${line.code}`, 56));
  }
  return out;
}

export function collectOpsGitDiffSnippetLines(
  files: readonly { readonly lines: readonly OpsGitDiffSnippetLine[] }[],
  maxLines: number = OPS_GIT_DIFF_SNIPPET_MAX_LINES,
): readonly string[] {
  const merged: OpsGitDiffSnippetLine[] = [];
  for (const file of files) {
    for (const line of file.lines) {
      merged.push(line);
      if (merged.length >= maxLines * 4) break;
    }
    if (merged.length >= maxLines * 4) break;
  }
  return formatOpsGitDiffSnippetLines(merged, maxLines);
}

export interface OpsTheatreInput {
  readonly refreshedAt: string;
  readonly sessionsLine: string;
  readonly fleetWorkers?: readonly OpsTheatreFleetWorker[];
  readonly goal: OpsTheatreGoalData | null | 'unavailable';
  readonly git: OpsTheatreGitData | null;
  readonly cwd: string;
  readonly mcpLine: string;
  readonly cacheHitLine: string;
  readonly cachePrefixLine: string | null;
  readonly cacheMissReasonLine: string | null;
  readonly cacheFreezeLine: string | null;
  readonly tokenGlanceLine: string;
  /** Live last-step TTFT from AppState.lastStepTtft (Host SSOT formatter). */
  readonly lastStepTtftLine: string | null;
  readonly breakerLine: string;
  readonly authLine: string;
  readonly routeLine: string | null;
  readonly search: OpsTheatreSearchData;
  readonly degraded: OpsTheatreDegradedData | null;
  readonly model: string;
  readonly permissionMode: PermissionMode;
  /** Live session SSOT — SessionStatus.permission when wired. */
  readonly permissionFromSession?: PermissionMode | undefined;
  readonly pendingApprovalToolName: string | null;
  readonly interventionCount?: number;
  readonly staleInterventionCount?: number;
  readonly oldestInterventionAgeMs?: number;
  /** SSOT — agent-core missionDualEmitStatusLine (SUPERLIORA_MISSION_DUAL_EMIT). */
  readonly missionDualEmitLine: string;
  /** SSOT — agent-core fleetDualEmitStatusLine (SUPERLIORA_FLEET_DUAL_EMIT). */
  readonly fleetDualEmitLine: string;
  readonly parallelTools?: FleetParallelToolsGlance;
  /** Live Maker≠Checker soft collision — AppState.makerCheckerSoftWarn when wired. */
  readonly makerCheckerSoftWarn?: string | null;
  /** Live Cost Guard — governance scan or sessionCostUsd SSOT when wired. */
  readonly costGuardOpsLine?: string;
  /** Live W6 verification sensor soft advisory — AppState.goalSoftAdvisory when wired. */
  readonly goalSoftAdvisory?: string | null;
  /** Live mission run from session.getUltraworkRun when wired (SSOT §9.2). */
  readonly missionRun?: MissionRunGlance;
  readonly ultraworkMode?: boolean;
}

export interface OpsTheatreInterventionInput {
  readonly pendingApprovalToolName: string | null;
  readonly interventionCount?: number;
  readonly staleInterventionCount?: number;
  readonly oldestInterventionAgeMs?: number;
}

export function buildOpsTheatrePanes(input: OpsTheatreInput): OpsTheatreGridPanes {
  return {
    fleet: buildFleetPane(input),
    goal: buildGoalPane(input),
    git: buildGitPane(input),
    health: buildHealthPane(input),
  };
}

/** Mid-turn steer is Ctrl-S — no `/steer` slash command. */
const OPS_STEER_HINT = 'Ctrl-S steer mid-turn';

function buildFleetGovernanceLines(input: OpsTheatreInput): readonly string[] {
  return [
    OPS_FLEET_EVIDENCE_TIP,
    formatFleetMakerCheckerSoftLiveLine(input.makerCheckerSoftWarn),
    OPS_FLEET_BUDGET_TIP,
    input.costGuardOpsLine ?? OPS_FLEET_COST_GUARD_TIP,
  ];
}

export function buildOpsTheatreInterventionTray(input: OpsTheatreInterventionInput): string[] {
  const hasApproval = input.pendingApprovalToolName != null;
  const interventionCount = input.interventionCount ?? 0;
  const staleCount = input.staleInterventionCount ?? 0;
  const hasInterventions = interventionCount > 0;
  const needsAttention = hasApproval || hasInterventions;
  const autoExpireHint = formatInterventionAutoExpireOpsHint(
    staleCount,
    input.oldestInterventionAgeMs,
  );
  const steerLine = `${OPS_STEER_HINT} · /ops auto-refreshes`;

  const lines: string[] = ['▼ Intervention tray'];

  if (needsAttention) {
    if (hasApproval) {
      lines.push(
        `Approval: ${truncate(input.pendingApprovalToolName, 36)} · approve/deny in panel`,
      );
    }
    if (hasInterventions) {
      const queueLine = formatInterventionQueueOpsLine(
        interventionCount,
        input.oldestInterventionAgeMs,
        staleCount,
      );
      if (queueLine != null) {
        lines.push(queueLine);
      }
    }
    if (autoExpireHint != null) {
      lines.push(autoExpireHint);
    }
    if (lines.length < 4) {
      lines.push(steerLine);
    }
  } else {
    lines.push('Approval: (clear) · Interventions: (none)');
    lines.push(steerLine);
  }

  return lines.slice(0, 4);
}

function buildFleetPane(input: OpsTheatreInput): string[] {
  const header = [`live ${input.refreshedAt}`];
  const governanceLines = buildFleetGovernanceLines(input);
  const parallelLine = formatFleetParallelToolsOpsLine(input.parallelTools);
  const dualEmitLine = input.fleetDualEmitLine;
  const workers = input.fleetWorkers;
  if (workers != null && workers.length > 0) {
    const workerLines = workers
      .slice(0, 3)
      .map((worker) => `• ${worker.status} ${truncate(worker.name, 48)}`);
    return [...header, ...workerLines, ...governanceLines, parallelLine, dualEmitLine];
  }
  return [...header, input.sessionsLine, ...governanceLines, parallelLine, dualEmitLine];
}

/** Ops Goal pane — live mission run line; null when Mission mode is off and no run metadata. */
export function resolveOpsMissionRunLine(input: {
  readonly missionRun?: MissionRunGlance;
  readonly ultraworkMode?: boolean;
}): string | null {
  const show = input.ultraworkMode === true || input.missionRun !== undefined;
  if (!show) return null;
  return formatMissionRunLine({
    ultraworkMode: input.ultraworkMode === true,
    workDir: '',
    missionRun: input.missionRun,
  });
}

function buildGoalPane(input: OpsTheatreInput): string[] {
  const dualEmitLine = input.missionDualEmitLine;
  const advisoryLine = formatGoalSoftAdvisoryOpsDisplayLine(input.goalSoftAdvisory);
  const missionRunLine = resolveOpsMissionRunLine(input);
  const missionPrefix = missionRunLine != null ? [missionRunLine] : [];

  if (input.goal === 'unavailable') {
    return [...missionPrefix, 'Goal: (unavailable)', advisoryLine, dualEmitLine];
  }
  if (input.goal == null) {
    return [...missionPrefix, 'Goal: (none)', advisoryLine, dualEmitLine];
  }
  return [
    ...missionPrefix,
    `Goal: ${input.goal.status} · ${truncate(input.goal.objective, 60)}`,
    formatGoalXpOpsLine(input.goal.xpGlance),
    advisoryLine,
    dualEmitLine,
  ];
}

function formatOpsGitStatusLine(git: OpsTheatreGitData): string {
  const sync =
    git.ahead > 0 || git.behind > 0
      ? ` · ↑${String(git.ahead)}↓${String(git.behind)}`
      : '';
  const dirtyLabel = git.dirty ? ' · dirty' : ' · clean';
  const fileCount =
    git.dirty && git.changedFileCount > 0
      ? ` · ${String(git.changedFileCount)} files`
      : '';
  return `Git: ${git.branch}${dirtyLabel}${fileCount} · +${String(git.diffAdded)}/−${String(git.diffDeleted)}${sync}`;
}

function buildGitPane(input: OpsTheatreInput): string[] {
  if (input.git == null) {
    return ['Git: (not a repo)', `cwd: ${input.cwd}`];
  }
  const gitLine = formatOpsGitStatusLine(input.git);
  const churnLine =
    input.git.churnDelta != null && input.git.churnDelta > 0
      ? `churn +${String(input.git.churnDelta)}`
      : null;
  const changedLines = (input.git.changedFiles ?? [])
    .slice(0, 3)
    .map((entry) => truncate(entry, 56));
  const diffSnippet = (input.git.diffSnippet ?? []).slice(0, OPS_GIT_DIFF_SNIPPET_MAX_LINES);
  return [
    gitLine,
    ...(churnLine != null ? [churnLine] : []),
    ...changedLines,
    ...diffSnippet,
    `cwd: ${input.cwd}`,
  ];
}

function buildHealthPane(input: OpsTheatreInput): string[] {
  const searchLine =
    (input.search.configured.length > 0
      ? `Search: ${input.search.configured.join(', ')} · free fallback on`
      : 'Search: free fallback only (DDG/local) · add API keys for paid channels') +
    (input.search.searchDegraded ? ' · channel degraded' : '') +
    input.search.lateChannelSuffix;

  const cascadeLine =
    input.search.cascadeLine ?? formatSearchCascadeOpsFallbackLine(input.search.searchDegraded);
  const researchHopsLine = input.search.researchHopsLine;
  const neverEmptyTelemetryLine = input.search.neverEmptyTelemetryLine;
  const localResearchCacheHitLine = input.search.localResearchCacheHitLine;

  const degradedLine =
    input.degraded != null
      ? `Degraded: ${input.degraded.scope} · ${truncate(input.degraded.reason, 48)}`
      : 'Degraded: (none)';

  const degradedHintLine =
    input.degraded?.hint != null && input.degraded.hint.trim().length > 0
      ? `Degraded hint: ${truncate(input.degraded.hint.trim(), 64)}`
      : null;

  return [
    input.mcpLine,
    input.cacheHitLine,
    ...(input.cachePrefixLine != null ? [input.cachePrefixLine] : []),
    ...(input.cacheMissReasonLine != null ? [input.cacheMissReasonLine] : []),
    ...(input.cacheFreezeLine != null ? [input.cacheFreezeLine] : []),
    input.tokenGlanceLine,
    ...(input.lastStepTtftLine != null ? [input.lastStepTtftLine] : []),
    input.breakerLine,
    input.authLine,
    ...(input.routeLine != null ? [input.routeLine] : []),
    searchLine,
    ...(cascadeLine != null ? [cascadeLine] : []),
    ...(researchHopsLine != null ? [researchHopsLine] : []),
    ...(neverEmptyTelemetryLine != null && neverEmptyTelemetryLine.length > 0
      ? [neverEmptyTelemetryLine]
      : []),
    ...(localResearchCacheHitLine != null && localResearchCacheHitLine.length > 0
      ? [localResearchCacheHitLine]
      : []),
    degradedLine,
    ...(degradedHintLine != null ? [degradedHintLine] : []),
    `Model: ${input.model}`,
    formatOpsPermissionLine(input.permissionMode, input.permissionFromSession),
  ];
}

function truncate(text: string, max: number): string {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}
