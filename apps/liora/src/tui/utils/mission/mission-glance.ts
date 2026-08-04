/**
 * Mission / Goals settings glance — live session goal + mission run (SSOT §9.2).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  MISSION_DUAL_EMIT_ENV,
  missionDualEmitStatusLine,
  type GoalSnapshot,
} from '@superliora/sdk';

import { CANONICAL_ULTRAWORK_EVIDENCE_ROOT } from '#/constant/workspace-data';
import { formatGoalXpOpsLine, resolveGoalXpOpsGlance } from '#/tui/utils/goal/goal-glance';

import type { AppState } from '#/tui/types';

export const MISSION_EVIDENCE_SENSOR_TIPS = [
  'Plain /goal: UpdateGoal(complete) adds soft advisory when no WorkGraph hard gate ran.',
  'W6 soft sensor: recent RunProjectChecks/Bash test failures append a non-blocking done warning.',
  'Mission/Ultrawork: hard-blocks done without evidence (requiredEvidence + verificationStatus).',
  'RunProjectChecks — preferred PostToolUse sensor after Edit/Write (Settings → Hooks).',
] as const;

/** Protocol rename soft path — mirrors agent-core/mission/event-alias.ts. */
export const MISSION_PROTOCOL_ALIAS_TIPS = [
  'Wire emits canonical ultrawork.*; mission.* accepted on read (normalize alias).',
  `Live mission.* duplicate: opt-in ${MISSION_DUAL_EMIT_ENV}=1 or SUPERLIORA_SOVEREIGN=1 (WS/RPC only — never journal).`,
  'Journal golden sequences require dual-emit OFF; durable trace stays ultrawork.* only.',
] as const;

/** Import-path soft path — hard disk rename pending (W5). */
export const MISSION_IMPORT_PATH_TIPS = [
  'Hard rename pending: ultrawork/ folder stays on disk until W5 cutover.',
  'New wiring: import via @superliora/agent-core/mission or agent-core #/mission (not #/ultrawork).',
  'SDK apps: @superliora/sdk/mission — wire types remain ultrawork.* until hard rename.',
  'Liora TUI cross-imports: #/tui/utils/mission/mission-contract (not commands/ultrawork/ultrawork-contract).',
] as const;

export { missionDualEmitStatusLine };

const MISSION_ARTIFACT_STATIC_TIPS = [
  'progress.md — stage ledger for resume',
  'features.json — verifiable feature checklist',
  `${CANONICAL_ULTRAWORK_EVIDENCE_ROOT}/<run-id>/ — live evidence seed today`,
] as const;

/** Operator path for artifact-only resume — covered by mission-resume-smoke + SL-smoke. */
export const MISSION_RESUME_E2E_TIP =
  'E2E: fresh session + `/mission resume` when evidence validates (mission-resume-smoke).';

export function missionMdArtifactTip(workDir: string): string {
  const missionPath = join(workDir, 'MISSION.md');
  return existsSync(missionPath)
    ? 'MISSION.md — present (operator objective + acceptance)'
    : 'MISSION.md — not found (future canonical root)';
}

export interface MissionRunGlance {
  readonly active: boolean;
  readonly status?: string;
  readonly stage?: string;
  readonly objective?: string;
}

export interface MissionSessionGlance {
  readonly ultraworkMode: boolean;
  readonly workDir: string;
  readonly missionRun?: MissionRunGlance;
  readonly goal?: GoalSnapshot | null;
  readonly goalQueueCount?: number;
  readonly sessionUnavailable?: boolean;
  /** Resolved mission.autoStart from harness config (default false). */
  readonly autoStart?: boolean;
  readonly appState?: Pick<AppState, 'goalEvidenceCount' | 'contextOS'>;
}

export function resolveMissionAutoStart(
  config: { readonly mission?: { readonly autoStart?: boolean } } | null | undefined,
): boolean {
  return config?.mission?.autoStart === true;
}

export function buildMissionAutoStartConfigPatch(enabled: boolean): {
  readonly mission: { readonly autoStart: boolean };
} {
  return { mission: { autoStart: enabled } };
}

export function formatMissionAutoStartLine(autoStart: boolean): string {
  return `Auto-start opt-in: ${autoStart ? 'ON' : 'OFF'} (mission.autoStart)`;
}

/** Status bar tip on session open when mission.autoStart opt-in is ON. */
export const MISSION_AUTOSTART_SESSION_TIP =
  'Mission auto-start opt-in ON — use `/mission resume` or `/mission <objective>` (no objective invented on session open).';

export interface MissionAutoStartSessionTipInput {
  readonly autoStart: boolean;
  readonly missionAlreadyActive?: boolean;
}

/** Returns session-open tip text, or null when opt-in is OFF or a Mission run is already active. */
export function resolveMissionAutoStartSessionTip(
  input: MissionAutoStartSessionTipInput,
): string | null {
  if (!input.autoStart || input.missionAlreadyActive === true) return null;
  return MISSION_AUTOSTART_SESSION_TIP;
}

const MAX_OBJECTIVE_PREVIEW = 56;

function truncateObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= MAX_OBJECTIVE_PREVIEW) return trimmed;
  return `${trimmed.slice(0, MAX_OBJECTIVE_PREVIEW - 1)}…`;
}

/** Live mission run line from session.getUltraworkRun when wired. */
export function formatMissionRunLine(glance: MissionSessionGlance): string {
  const { missionRun, ultraworkMode, sessionUnavailable } = glance;

  if (sessionUnavailable === true) {
    return ultraworkMode ? 'Mission mode: ON · (session unavailable)' : 'Mission run: (session unavailable)';
  }

  if (missionRun === undefined) {
    return ultraworkMode ? 'Mission mode: ON (awaiting run metadata)' : 'Mission run: none';
  }

  const stagePart = missionRun.stage !== undefined ? ` · stage ${missionRun.stage}` : '';
  const objectivePart =
    missionRun.objective !== undefined && missionRun.objective.trim().length > 0
      ? ` · "${truncateObjective(missionRun.objective)}"`
      : '';

  if (missionRun.active) {
    return `Mission run: active${stagePart}${objectivePart}`;
  }

  if (missionRun.status === 'awaiting') {
    return 'Mission mode: ON (awaiting run metadata)';
  }

  const status = missionRun.status ?? 'idle';
  return `Mission run: ${status}${stagePart}${objectivePart}`;
}

/** Live active goal from appState or session.getGoal when wired. */
export function formatActiveGoalLine(glance: MissionSessionGlance): string {
  const goal = glance.goal;
  if (goal == null) {
    return glance.sessionUnavailable === true
      ? 'Active goal: (session unavailable)'
      : 'Active goal: none';
  }

  const objectivePart =
    goal.objective.trim().length > 0 ? ` · "${truncateObjective(goal.objective)}"` : '';
  return `Active goal: ${goal.status} · turns ${String(goal.turnsUsed)} · tokens ${String(goal.tokensUsed)}${objectivePart}`;
}

/** Goal XP / evidence counters when session goal is present. */
export function formatMissionGoalXpLine(glance: MissionSessionGlance): string | undefined {
  if (glance.goal == null) return undefined;
  const xpGlance = resolveGoalXpOpsGlance({
    goal: glance.goal,
    appState: glance.appState,
  });
  const line = formatGoalXpOpsLine(xpGlance);
  return line.startsWith('XP:') || line.startsWith('Evidence:') ? line : undefined;
}

/** Upcoming goal queue count from readGoalQueue when wired. */
export function formatGoalQueueLine(glance: MissionSessionGlance): string {
  const { goalQueueCount, sessionUnavailable } = glance;
  if (goalQueueCount === undefined) {
    return sessionUnavailable === true
      ? 'Upcoming goals: (session unavailable)'
      : 'Upcoming goals: open a session to count queue';
  }
  if (goalQueueCount === 0) return 'Upcoming goals: (empty)';
  const label = goalQueueCount === 1 ? 'goal' : 'goals';
  return `Upcoming goals: ${String(goalQueueCount)} queued ${label}`;
}

export interface MissionSettingsTipsInput {
  readonly workDir: string;
}

export function buildMissionSettingsLines(
  session: MissionSessionGlance,
  tips: MissionSettingsTipsInput = { workDir: session.workDir },
): readonly string[] {
  const missionRunLine = formatMissionRunLine(session);
  const activeGoalLine = formatActiveGoalLine(session);
  const goalXpLine = formatMissionGoalXpLine(session);
  const goalQueueLine = formatGoalQueueLine(session);
  const modeLine = `Mission mode: ${session.ultraworkMode ? 'ON' : 'OFF'}`;

  return [
    '── Mission / Goals ─────────────────────────',
    'Long-run objective loop — Sovereign Reform §7.3.',
    '',
    '── Session (live) ───────────────────────────',
    missionRunLine,
    modeLine,
    activeGoalLine,
    ...(goalXpLine != null ? [goalXpLine] : []),
    goalQueueLine,
    `Workspace: ${session.workDir}`,
    '',
    '── Auto-start ───────────────────────────────',
    formatMissionAutoStartLine(session.autoStart === true),
    'Default OFF — Mission never invents an objective on session open.',
    'ON records opt-in intent only; session open shows a status tip — still start with `/mission <objective>` or `/mission resume`.',
    'Toggle: Settings → Mission → Auto-start ON/OFF → mission.autoStart.',
    '',
    '── Commands ─────────────────────────────────',
    '  /mission <objective>   start or replace Mission run',
    '  /mission pause|resume|cancel   lifecycle',
    '  /goal                    verifiable Goal contract',
    '',
    '── Evidence checks ──────────────────────────',
    'ContextOS tracks evidence-id recall before resume.',
    'Footer warns when durable evidence missing after compaction.',
    'Mission Resume: artifacts under .superliora/evidence/ must validate.',
    `· ${MISSION_RESUME_E2E_TIP}`,
    ...MISSION_EVIDENCE_SENSOR_TIPS.map((tip) => `· ${tip}`),
    '',
    '── Protocol aliases ─────────────────────────',
    missionDualEmitStatusLine(),
    ...MISSION_PROTOCOL_ALIAS_TIPS.map((tip) => `· ${tip}`),
    '',
    '── Import path (soft rename) ────────────────',
    ...MISSION_IMPORT_PATH_TIPS.map((tip) => `· ${tip}`),
    '',
    '── Artifact paths ───────────────────────────',
    `· ${missionMdArtifactTip(tips.workDir)}`,
    ...MISSION_ARTIFACT_STATIC_TIPS.map((tip) => `· ${tip}`),
  ];
}
