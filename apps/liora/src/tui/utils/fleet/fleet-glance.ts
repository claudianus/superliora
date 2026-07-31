/**
 * Fleet settings + Ops glance — evidence gate and budget governor tips (W4 / §7.1).
 * SSOT: agent-core collaboration/swarm-evidence-gate + swarm-budget.
 */

import { FLEET_WORKTREE_ENV, isFleetWorktreeEnvEnabled } from '@superliora/sdk';

export { FLEET_WORKTREE_ENV };

/** Settings — Maker≠Checker evidence hard gate (swarm-evidence-gate). */
export const FLEET_EVIDENCE_GATE_TIP =
  'Maker≠Checker: WorkGraph done blocked without requiredEvidence + matching check tokens (swarm-evidence-gate).';

/** Settings — Maker≠Checker runtime soft collision (swarm-maker-checker). */
export const FLEET_MAKER_CHECKER_SOFT_TIP =
  'Maker≠Checker (soft): runtime warns when the same expert both implements and reviews (swarm-maker-checker).';

/** Settings — wasted-round budget governor hard cap (swarm-budget). */
export const FLEET_BUDGET_HARD_CAP_TIP =
  'Wasted-round hard-cap: ≥2 rounds without evidence/artifacts/files/tools/verify → suggest kill (swarm-budget).';

/** Korean brief — evidence gate operator summary. */
export const FLEET_EVIDENCE_GATE_TIP_KO =
  '증거 게이트: Maker≠Checker — done는 requiredEvidence·검증 토큰 일치 필요 (swarm-evidence-gate).';

/** Korean brief — runtime soft collision operator summary. */
export const FLEET_MAKER_CHECKER_SOFT_TIP_KO =
  'Maker≠Checker(soft): 동일 전문가가 구현·리뷰 겸임 시 런타임 경고 (swarm-maker-checker).';

/** Korean brief — budget governor operator summary. */
export const FLEET_BUDGET_HARD_CAP_TIP_KO =
  '예산 거버너: 고신호 진행 없이 낭비 라운드 ≥2회면 kill 제안 (swarm-budget).';

/** Settings — parallel wall-clock speedup (soft target). */
export const FLEET_PARALLEL_SPEEDUP_TIP =
  'Parallel speedup (soft): independent tool_calls fan out per turn when safe.';

/** Korean brief — parallel speedup operator summary. */
export const FLEET_PARALLEL_SPEEDUP_TIP_KO =
  '병렬 가속(soft): 동일 턴 독립 tool_calls는 충돌 없을 때 병렬 실행.';

/** Compact Ops Fleet pane — evidence gate one-liner. */
export const OPS_FLEET_EVIDENCE_TIP =
  'Evidence: Maker≠Checker · requiredEvidence match';

/** Compact Ops Fleet pane — maker-checker soft one-liner. */
export const OPS_FLEET_MAKER_CHECKER_SOFT_TIP = 'Maker≠Checker (soft): same expert make+check';

/** Compact Ops Fleet pane — budget governor one-liner. */
export const OPS_FLEET_BUDGET_TIP = 'Budget: ≥2 wasted rounds → kill suggest';

/** W4 soft: session $ cap for Fleet Cost Guard (AgentSwarm/UltraSwarm — env opt-in). */
export const FLEET_BUDGET_USD_ENV = 'SUPERLIORA_FLEET_BUDGET_USD';

/** Settings — Cost Guard soft-stop before session $ cap (§7.1 / §9.4). */
export const FLEET_COST_GUARD_TIP =
  'Cost Guard (soft): SUPERLIORA_FLEET_BUDGET_USD caps session spend — soft-stop + summary before kill (not swarm-budget rounds).';

/** Korean brief — Cost Guard operator summary. */
export const FLEET_COST_GUARD_TIP_KO =
  'Cost Guard(soft): SUPERLIORA_FLEET_BUDGET_USD 세션 $ 상한 — kill 전 soft-stop·요약 (swarm-budget 라운드와 별개).';

/** SSOT §9.2 — same-turn tool fanout (agent-core ToolScheduler). */
export const OPS_FLEET_PARALLEL_FANOUT_TIP =
  'Parallel: independent tool_calls fan out per turn';

export interface FleetParallelToolsGlance {
  readonly parallelToolsInFlight?: number;
  readonly maxParallelTools?: number;
}

export interface FleetOrchestratorWorkerGlance {
  readonly status: string;
}

export interface FleetBackgroundWorkerGlance {
  readonly bash: number;
  readonly agent: number;
}

/** Live worker pool for Settings → Fleet Session (live) block. */
export interface FleetSessionLiveGlance {
  readonly sessionUnavailable?: boolean;
  readonly orchestratorWorkers?: readonly FleetOrchestratorWorkerGlance[];
  readonly backgroundActive?: FleetBackgroundWorkerGlance;
  readonly parallelTools?: FleetParallelToolsGlance;
  readonly makerCheckerSoftWarn?: string | null;
  /** Process env SUPERLIORA_FLEET_WORKTREE — always live (not session-scoped). */
  readonly worktree?: FleetWorktreeGlance;
}

/** Settings line — orchestrator pool or active background tasks when wired. */
export function formatFleetWorkersSettingsLine(
  glance: Pick<FleetSessionLiveGlance, 'orchestratorWorkers' | 'backgroundActive'> | undefined,
): string {
  if (glance === undefined) {
    return 'Workers: (session unavailable)';
  }
  const workers = glance.orchestratorWorkers;
  if (workers !== undefined && workers.length > 0) {
    const running = workers.filter((w) => w.status === 'running').length;
    const completed = workers.filter((w) => w.status === 'completed').length;
    const failed = workers.filter((w) => w.status === 'failed').length;
    const parts: string[] = [`${String(workers.length)} orchestrator`];
    if (running > 0) parts.unshift(`${String(running)} running`);
    if (completed > 0) parts.push(`${String(completed)} done`);
    if (failed > 0) parts.push(`${String(failed)} failed`);
    return `Workers: ${parts.join(' · ')}`;
  }
  const bg = glance.backgroundActive;
  if (bg !== undefined && (bg.bash > 0 || bg.agent > 0)) {
    const parts: string[] = [];
    if (bg.bash > 0) parts.push(`${String(bg.bash)} bash`);
    if (bg.agent > 0) parts.push(`${String(bg.agent)} agent`);
    return `Workers: ${parts.join(' · ')} background active`;
  }
  return 'Workers: none active — /orchestrator or /fleet to spawn';
}

/** Settings Session (live) block — worker count + parallel tools from getStatus when wired. */
export function buildFleetSessionLiveLines(glance: FleetSessionLiveGlance): readonly string[] {
  const worktreeLine = formatFleetWorktreeEnvLiveLine(glance.worktree);
  if (glance.sessionUnavailable) {
    return [
      '── Session (live) ───────────────────────────',
      'Workers: (session unavailable)',
      formatFleetParallelToolsOpsLine(undefined),
      formatFleetMakerCheckerSoftLiveLine(undefined),
      worktreeLine,
      '',
    ];
  }
  return [
    '── Session (live) ───────────────────────────',
    formatFleetWorkersSettingsLine(glance),
    formatFleetParallelToolsOpsLine(glance.parallelTools),
    formatFleetMakerCheckerSoftLiveLine(glance.makerCheckerSoftWarn),
    worktreeLine,
    '',
  ];
}

/** SSOT — SessionStatus parallel tool counters → Fleet/Ops glance. */
export function resolveFleetParallelToolsGlanceFromStatus(
  status: unknown,
): FleetParallelToolsGlance | undefined {
  if (status === null || status === undefined || typeof status !== 'object') return undefined;
  const record = status as Record<string, unknown>;
  const inFlight = record['parallelToolsInFlight'];
  const maxParallel = record['maxParallelTools'];
  const hasInFlight = typeof inFlight === 'number';
  const hasMax = typeof maxParallel === 'number';
  if (!hasInFlight && !hasMax) return undefined;
  return {
    ...(hasInFlight ? { parallelToolsInFlight: inFlight } : {}),
    ...(hasMax ? { maxParallelTools: maxParallel } : {}),
  };
}

/** Ops/Fleet line — live parallel tool_calls when status is wired; else soft tip. */
export function formatFleetParallelToolsOpsLine(
  glance?: FleetParallelToolsGlance | null,
): string {
  const inFlight = glance?.parallelToolsInFlight;
  const maxParallel = glance?.maxParallelTools;
  if (typeof inFlight === 'number' && inFlight > 0) {
    const peak =
      typeof maxParallel === 'number' && maxParallel > inFlight
        ? ` · peak ${String(maxParallel)}`
        : '';
    return `Parallel tools: ${String(inFlight)} in flight${peak}`;
  }
  if (typeof inFlight === 'number' || typeof maxParallel === 'number') {
    if (typeof maxParallel === 'number' && maxParallel > 0) {
      return `Parallel tools: idle · turn peak ${String(maxParallel)}`;
    }
    return 'Parallel tools: idle';
  }
  return OPS_FLEET_PARALLEL_FANOUT_TIP;
}

/** Settings Session (live) — Maker≠Checker soft collision from AppState when wired. */
export function formatFleetMakerCheckerSoftLiveLine(warn: string | null | undefined): string {
  if (warn !== undefined && warn !== null && warn.trim().length > 0) {
    const trimmed = warn.trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
  }
  return OPS_FLEET_MAKER_CHECKER_SOFT_TIP;
}

/** Compact Ops Fleet pane — Cost Guard env one-liner. */
export const OPS_FLEET_COST_GUARD_TIP = 'Cost Guard: $ budget soft-stop (env cap)';

/** Ops Fleet pane — live Cost Guard detail or compact fallback. */
export function formatFleetCostGuardOpsLiveLine(liveDetail: string | null | undefined): string {
  if (liveDetail !== undefined && liveDetail !== null && liveDetail.trim().length > 0) {
    const line =
      liveDetail.trim().startsWith('Cost Guard:')
        ? liveDetail.trim()
        : `Cost Guard: ${liveDetail.trim()}`;
    return line.length > 120 ? `${line.slice(0, 117)}…` : line;
  }
  return OPS_FLEET_COST_GUARD_TIP;
}

export const FLEET_GOVERNANCE_TIPS = [
  FLEET_EVIDENCE_GATE_TIP,
  FLEET_MAKER_CHECKER_SOFT_TIP,
  FLEET_BUDGET_HARD_CAP_TIP,
  FLEET_PARALLEL_SPEEDUP_TIP,
] as const;

/** Settings — session-level worktree isolation (live). */
export const FLEET_WORKTREE_SESSION_TIP =
  'Session: liora --worktree [name] · /fork --worktree [name] — live (~/.superliora/worktrees).';

/** Settings — orchestrator SpawnWorker worktree path (agent-core orchestrator.ts). */
export const FLEET_WORKTREE_ORCHESTRATOR_TIP =
  'Orchestrator (/orchestrator on): SpawnWorker creates per-worker git worktrees (agent-core).';

/** Settings — AgentSwarm/UltraSwarm per-worker worktree when env opt-in is on. */
export const FLEET_WORKTREE_SWARM_FUTURE_TIP =
  'AgentSwarm/UltraSwarm: SUPERLIORA_FLEET_WORKTREE=1 attempts per-worker git worktrees (shared workDir fallback on failure).';

/** Settings — env opt-in line for fleet worker isolation. */
export const FLEET_WORKTREE_ENV_TIP =
  `Opt-in (soft): ${FLEET_WORKTREE_ENV}=1 reserves fleet worker isolation — wiring follows W4 slice.`;

/** Korean brief — worktree isolation operator summary. */
export const FLEET_WORKTREE_TIP_KO =
  '워크트리 격리: 세션(--worktree) live · Orchestrator SpawnWorker worktree · AgentSwarm worktreeDir W4 · SUPERLIORA_FLEET_WORKTREE=1 soft opt-in.';

export interface FleetWorktreeGlance {
  readonly envEnabled: boolean;
  readonly envValue: string | undefined;
}

/** Compact Ops / Session (live) — worktree env one-liner when off or unwired. */
export const OPS_FLEET_WORKTREE_TIP =
  `Fleet worktree: off — ${FLEET_WORKTREE_ENV}=1 for per-worker git worktrees`;

/** Settings + Session (live) — SUPERLIORA_FLEET_WORKTREE ON/OFF (SSOT: isFleetWorktreeEnvEnabled). */
export function formatFleetWorktreeEnvStatusLine(glance: FleetWorktreeGlance): string {
  return glance.envEnabled
    ? `${FLEET_WORKTREE_ENV}=ON (${glance.envValue ?? '1'}) — AgentSwarm/UltraSwarm attempt per-worker worktrees.`
    : `${FLEET_WORKTREE_ENV}: off — set =1 to opt into fleet worker isolation (W4).`;
}

/** Session (live) — live env ON/OFF; falls back to compact tip when unwired. */
export function formatFleetWorktreeEnvLiveLine(
  glance?: FleetWorktreeGlance | null,
): string {
  if (glance == null) {
    return OPS_FLEET_WORKTREE_TIP;
  }
  return formatFleetWorktreeEnvStatusLine(glance);
}

export function loadFleetWorktreeGlance(env: NodeJS.ProcessEnv = process.env): FleetWorktreeGlance {
  const envValue = env[FLEET_WORKTREE_ENV]?.trim();
  return {
    envEnabled: isFleetWorktreeEnvEnabled(env),
    envValue: envValue !== undefined && envValue.length > 0 ? envValue : undefined,
  };
}

/** Settings → Fleet / Parallel worktree isolation block (read-only). */
export interface FleetBudgetGlance {
  readonly budgetUsd: number | null;
  readonly envValue: string | undefined;
}

function parseFleetBudgetUsd(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function loadFleetBudgetGlance(env: NodeJS.ProcessEnv = process.env): FleetBudgetGlance {
  const envValue = env[FLEET_BUDGET_USD_ENV]?.trim();
  return {
    budgetUsd: parseFleetBudgetUsd(envValue),
    envValue: envValue !== undefined && envValue.length > 0 ? envValue : undefined,
  };
}

export interface FleetCostGuardSoftCheck {
  readonly active: boolean;
  readonly budgetUsd: number | null;
  readonly spentUsd: number | null;
  readonly remainingUsd: number | null;
  readonly overBudget: boolean;
  readonly nearBudget: boolean;
}

const FLEET_COST_GUARD_NEAR_RATIO = 0.8;

export function evaluateFleetCostGuardSoft(
  glance: FleetBudgetGlance,
  spentUsd: number | undefined,
): FleetCostGuardSoftCheck {
  const budgetUsd = glance.budgetUsd;
  const active = budgetUsd !== null;
  const spent =
    typeof spentUsd === 'number' && Number.isFinite(spentUsd) && spentUsd >= 0 ? spentUsd : null;
  if (!active || budgetUsd === null) {
    return {
      active: false,
      budgetUsd: null,
      spentUsd: spent,
      remainingUsd: null,
      overBudget: false,
      nearBudget: false,
    };
  }
  const remainingUsd = spent !== null ? budgetUsd - spent : budgetUsd;
  const overBudget = spent !== null && spent >= budgetUsd;
  const nearBudget =
    spent !== null && !overBudget && spent >= budgetUsd * FLEET_COST_GUARD_NEAR_RATIO;
  return {
    active: true,
    budgetUsd,
    spentUsd: spent,
    remainingUsd,
    overBudget,
    nearBudget,
  };
}

export function formatFleetBudgetUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Settings → Fleet / Parallel Cost Guard block (read-only soft check). */
export function buildFleetCostGuardSettingsLines(
  glance: FleetBudgetGlance,
  spentUsd: number | undefined,
): readonly string[] {
  if (glance.budgetUsd === null) {
    const invalidHint =
      glance.envValue !== undefined
        ? `${FLEET_BUDGET_USD_ENV}=${glance.envValue} — invalid; use a positive number (e.g. 5.00).`
        : `${FLEET_BUDGET_USD_ENV}: off — set e.g. =5.00 for session $ cap (soft-stop).`;
    return [
      '── Cost Guard (soft) ────────────────────────',
      invalidHint,
      FLEET_COST_GUARD_TIP,
      'Today: watch Usage panel + footer token/$ glance during Fleet runs.',
    ];
  }

  const check = evaluateFleetCostGuardSoft(glance, spentUsd);
  const capLine = `${FLEET_BUDGET_USD_ENV}=${formatFleetBudgetUsd(check.budgetUsd!)} — Cost Guard soft active.`;

  let softCheckLine = 'Soft check: (no session spend yet) · cap applies on next usage tick.';
  if (check.spentUsd !== null) {
    const spent = formatFleetBudgetUsd(check.spentUsd);
    const cap = formatFleetBudgetUsd(check.budgetUsd!);
    if (check.overBudget) {
      const over = formatFleetBudgetUsd(check.spentUsd - check.budgetUsd!);
      softCheckLine = `Soft check: spent ${spent} / ${cap} · over ${over} — pause + summary (no kill).`;
    } else if (check.nearBudget && check.remainingUsd !== null) {
      softCheckLine = `Soft check: spent ${spent} / ${cap} · ${formatFleetBudgetUsd(check.remainingUsd)} left · near cap (≥80%).`;
    } else if (check.remainingUsd !== null) {
      softCheckLine = `Soft check: spent ${spent} / ${cap} · ${formatFleetBudgetUsd(check.remainingUsd)} remaining.`;
    }
  }

  return [
    '── Cost Guard (soft) ────────────────────────',
    capLine,
    softCheckLine,
    FLEET_COST_GUARD_TIP,
  ];
}

export function buildFleetWorktreeSettingsLines(
  glance: FleetWorktreeGlance,
  orchestratorOn: boolean,
): readonly string[] {
  const envStatus = formatFleetWorktreeEnvStatusLine(glance);

  const orchestratorLine = orchestratorOn
    ? 'Orchestrator: ON — SpawnWorker attempts git worktree per worker.'
    : 'Orchestrator: OFF — /orchestrator on enables SpawnWorker worktree path.';

  return [
    '── Worktree isolation ───────────────────────',
    envStatus,
    orchestratorLine,
    FLEET_WORKTREE_SESSION_TIP,
    FLEET_WORKTREE_ORCHESTRATOR_TIP,
    FLEET_WORKTREE_SWARM_FUTURE_TIP,
    'Storage: ~/.superliora/worktrees — registry via liora worktree list.',
    'Kaos sandbox worktree profile — planned (packages/kaos); no KAOS_* env yet.',
  ];
}
