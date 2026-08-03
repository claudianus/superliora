/**
 * Maker≠Checker soft collision detection for the fleet fan-out tools.
 *
 * Hard evidence separation lives in swarm-evidence-gate; this module emits
 * non-blocking tips by default. Opt-in hard gate via
 * `SUPERLIORA_MAKER_CHECKER_HARD=1` (or `maker_checker_hard_gate=1`) blocks
 * fan-out until a distinct checker role is present (SOTA G10).
 *
 * S3-R6 interim home (moved from swarm-maker-checker.ts). S3-R7 verdict:
 * RETAIN — the liora TUI glances still consume these heuristics; the R7
 * final sweep deleted the retired UltraSwarm-named wrappers and exports.
 */

export const SWARM_MAKER_CHECKER_SOFT_TIP =
  'Maker≠Checker (soft): same expert/role must not both implement and review — restaff an independent checker (swarm-maker-checker).';

export const SWARM_MAKER_CHECKER_AGENT_SWARM_TIP =
  'Maker≠Checker (soft): AgentSwarm items mix implement + review/check intents in one homogeneous batch — split maker vs checker runs (swarm-maker-checker).';

/** Env flag: force Maker≠Checker hard reject (default off — soft tips only). */
export const MAKER_CHECKER_HARD_GATE_ENV = 'SUPERLIORA_MAKER_CHECKER_HARD' as const;
/** Compat alias used in harness docs / board. */
export const MAKER_CHECKER_HARD_GATE_ENV_ALIAS = 'maker_checker_hard_gate' as const;

export const SWARM_MAKER_CHECKER_HARD_PREFIX = 'Maker≠Checker hard gate:' as const;

export function isMakerCheckerHardGateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthyEnv(env[MAKER_CHECKER_HARD_GATE_ENV]) || isTruthyEnv(env[MAKER_CHECKER_HARD_GATE_ENV_ALIAS]);
}

function isTruthyEnv(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Soft tip stays unchanged; hard mode prefixes so callers can block spawn.
 */
export function applyMakerCheckerHardGate(
  softTip: string | undefined,
  options?: { readonly hardGate?: boolean; readonly env?: NodeJS.ProcessEnv },
): string | undefined {
  if (softTip === undefined) return undefined;
  const hard =
    options?.hardGate === true ||
    isMakerCheckerHardGateEnabled(options?.env ?? process.env);
  if (!hard) return softTip;
  return [
    `${SWARM_MAKER_CHECKER_HARD_PREFIX} fan-out blocked until a distinct checker role is present.`,
    softTip,
    `Disable with unset ${MAKER_CHECKER_HARD_GATE_ENV} (default soft tips only).`,
  ].join('\n');
}

export function isMakerCheckerHardReject(message: string | undefined): boolean {
  return typeof message === 'string' && message.startsWith(SWARM_MAKER_CHECKER_HARD_PREFIX);
}

export type SwarmMakerCheckerRole = 'maker' | 'checker';

export interface SwarmRoleAssignment {
  readonly expertId: string;
  readonly expertName?: string;
  readonly role: SwarmMakerCheckerRole;
  readonly phase?: string;
  readonly coverageLane?: string;
}

export interface MakerCheckerCollision {
  readonly expertId: string;
  readonly expertName?: string;
  readonly makerPhase?: string;
  readonly checkerPhase?: string;
}

const MAKER_ITEM_HINT =
  /\b(implement|build|write|create|fix|patch|add|develop|code|ship|refactor)\b/i;
const CHECKER_ITEM_HINT =
  /\b(review|verify|audit|check|validate|inspect|critique|approve|assess)\b/i;

/** Classify swarm phase strings into maker vs checker roles. */
export function classifySwarmPhaseRole(phase: string): SwarmMakerCheckerRole | undefined {
  const normalized = phase.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  if (normalized === 'review' || normalized.startsWith('review-')) return 'checker';
  if (normalized === 'implement' || normalized === 'plan' || normalized === 'research') {
    return 'maker';
  }
  return undefined;
}

/** Classify coverage lane / roster role strings (mirrors swarm-phase heuristics). */
export function classifySwarmLaneRole(
  coverageLane: string | undefined,
): SwarmMakerCheckerRole | undefined {
  if (coverageLane === undefined) return undefined;
  const key = coverageLane.trim().toLowerCase().replaceAll(/[^a-z0-9_]+/g, '_');
  if (key.length === 0) return undefined;

  if (
    key.includes('review') ||
    key.includes('checker') ||
    key === 'testing_evidence' ||
    key === 'security_privacy' ||
    key === 'performance_reliability' ||
    key === 'qa'
  ) {
    return 'checker';
  }

  if (
    key.includes('implement') ||
    key === 'architecture_implementation' ||
    key === 'product_requirements' ||
    key === 'domain_subject_matter'
  ) {
    return 'maker';
  }

  return undefined;
}

export function classifyExpertRoleString(role: string | undefined): SwarmMakerCheckerRole | undefined {
  if (role === undefined) return undefined;
  const key = role.trim().toLowerCase();
  if (key.length === 0) return undefined;
  if (key.includes('review') || key.includes('checker') || key.includes('audit')) {
    return 'checker';
  }
  if (
    key.includes('implement') ||
    key.includes('maker') ||
    key.includes('coder') ||
    key.includes('builder')
  ) {
    return 'maker';
  }
  return undefined;
}

function roleForAssignment(input: {
  readonly phase?: string;
  readonly coverageLane?: string;
  readonly role?: string;
  readonly focus?: string;
}): SwarmMakerCheckerRole | undefined {
  return (
    (input.phase !== undefined ? classifySwarmPhaseRole(input.phase) : undefined) ??
    (input.focus !== undefined ? classifySwarmPhaseRole(input.focus) : undefined) ??
    classifySwarmLaneRole(input.coverageLane) ??
    classifyExpertRoleString(input.role)
  );
}

/** True when AgentSwarm items mix implement and review/check intents in one batch. */
export function detectAgentSwarmItemRoleCollision(
  items: readonly string[],
  promptTemplate?: string,
): boolean {
  let hasMaker = false;
  let hasChecker = false;
  const scan = (text: string): void => {
    if (MAKER_ITEM_HINT.test(text)) hasMaker = true;
    if (CHECKER_ITEM_HINT.test(text)) hasChecker = true;
  };
  for (const item of items) scan(item);
  if (promptTemplate !== undefined) scan(promptTemplate);
  return hasMaker && hasChecker;
}

/** Group assignments by expertId; collision when both maker and checker appear. */
export function detectMakerCheckerCollisions(
  assignments: readonly SwarmRoleAssignment[],
): readonly MakerCheckerCollision[] {
  const byExpert = new Map<
    string,
    {
      readonly expertName?: string;
      hasMaker: boolean;
      hasChecker: boolean;
      makerPhase?: string;
      checkerPhase?: string;
    }
  >();

  for (const assignment of assignments) {
    const expertId = assignment.expertId.trim();
    if (expertId.length === 0) continue;
    const entry = byExpert.get(expertId) ?? {
      expertName: assignment.expertName,
      hasMaker: false,
      hasChecker: false,
    };
    const next = { ...entry, expertName: entry.expertName ?? assignment.expertName };
    if (assignment.role === 'maker') {
      next.hasMaker = true;
      next.makerPhase = next.makerPhase ?? assignment.phase;
    } else {
      next.hasChecker = true;
      next.checkerPhase = next.checkerPhase ?? assignment.phase;
    }
    byExpert.set(expertId, next);
  }

  const collisions: MakerCheckerCollision[] = [];
  for (const [expertId, entry] of byExpert) {
    if (!entry.hasMaker || !entry.hasChecker) continue;
    collisions.push({
      expertId,
      expertName: entry.expertName,
      makerPhase: entry.makerPhase,
      checkerPhase: entry.checkerPhase,
    });
  }
  return collisions;
}

export function detectMakerCheckerCollisionsFromAssignments(
  rows: readonly {
    readonly expertId: string;
    readonly expertName?: string;
    readonly phase?: string;
    readonly focus?: string;
    readonly coverageLane?: string;
    readonly role?: string;
  }[],
): readonly MakerCheckerCollision[] {
  const assignments: SwarmRoleAssignment[] = [];
  for (const row of rows) {
    const role = roleForAssignment(row);
    if (role === undefined) continue;
    assignments.push({
      expertId: row.expertId,
      expertName: row.expertName,
      role,
      phase: row.phase ?? row.focus,
      coverageLane: row.coverageLane,
    });
  }
  return detectMakerCheckerCollisions(assignments);
}

export function formatMakerCheckerSoftWarn(
  collisions: readonly MakerCheckerCollision[],
  options?: { readonly hardGate?: boolean; readonly env?: NodeJS.ProcessEnv },
): string | undefined {
  if (collisions.length === 0) return undefined;
  const labels = collisions.map((collision) => {
    const name = collision.expertName?.trim();
    return name !== undefined && name.length > 0 ? name : collision.expertId;
  });
  const uniqueLabels = [...new Set(labels)];
  const roster = uniqueLabels.slice(0, 4).join(', ');
  const suffix = uniqueLabels.length > 4 ? ` +${String(uniqueLabels.length - 4)} more` : '';
  const soft = `${SWARM_MAKER_CHECKER_SOFT_TIP} Colliding expert(s): ${roster}${suffix}.`;
  return applyMakerCheckerHardGate(soft, options);
}

export function makerCheckerSoftWarnFromAgentSwarmItems(
  items: readonly string[],
  promptTemplate?: string,
  options?: { readonly hardGate?: boolean; readonly env?: NodeJS.ProcessEnv },
): string | undefined {
  if (!detectAgentSwarmItemRoleCollision(items, promptTemplate)) return undefined;
  return applyMakerCheckerHardGate(SWARM_MAKER_CHECKER_AGENT_SWARM_TIP, options);
}

/** Best-effort parse of `<expert … phase="…">` / `<agent … phase="…">` rows from tool output. */
export function detectMakerCheckerCollisionsFromSwarmOutput(
  output: string,
): readonly MakerCheckerCollision[] {
  const rows: {
    expertId: string;
    expertName?: string;
    phase?: string;
    focus?: string;
    coverageLane?: string;
  }[] = [];

  const tagPattern = /<(expert|agent)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(output)) !== null) {
    const attrs = match[2] ?? '';
    const expertId = xmlAttr(attrs, 'expert_id');
    if (expertId === undefined) continue;
    rows.push({
      expertId,
      expertName: xmlAttr(attrs, 'name'),
      phase: xmlAttr(attrs, 'phase'),
      focus: xmlAttr(attrs, 'focus'),
      coverageLane: xmlAttr(attrs, 'coverage_lane'),
    });
  }

  return detectMakerCheckerCollisionsFromAssignments(rows);
}

export function makerCheckerSoftWarnFromSwarmOutput(
  output: string,
  options?: { readonly hardGate?: boolean; readonly env?: NodeJS.ProcessEnv },
): string | undefined {
  return formatMakerCheckerSoftWarn(detectMakerCheckerCollisionsFromSwarmOutput(output), options);
}

function xmlAttr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}
