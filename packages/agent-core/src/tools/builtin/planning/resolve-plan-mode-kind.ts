/**
 * Regular vs Ultra (structured) plan routing — concrete criteria for auto-select
 * when EnterPlanMode omits `ultra`.
 *
 * Regular: short free-form plan file for scoped, already-clear work.
 * Ultra: Ouroboros-style Socratic interview → Seed Spec / AC Tree / verifiable goal
 * before implementation (ambiguity gate ≤ 0.2).
 */

export type PlanModeKind = 'regular' | 'ultra';

export interface ResolvePlanModeKindInput {
  /** Explicit tool/RPC flag; wins when set. */
  readonly ultra?: boolean;
  readonly initialContext?: string;
  readonly source?: 'standalone' | 'ultrawork';
}

export interface ResolvePlanModeKindResult {
  readonly kind: PlanModeKind;
  /** Why this kind was chosen (for tool output / telemetry). */
  readonly reason: string;
}

/** Signals that requirements are still vague / high-stakes → Ultra. */
const ULTRA_SIGNALS: readonly RegExp[] = [
  /\b(build|create|make|ship|launch)\b.{0,40}\b(app|game|product|system|platform|service|cli|mvp)\b/i,
  /\b(from scratch|greenfield|new (feature|product|project)|0→1|zero to one)\b/i,
  /\b(architect|multi[- ]?file|refactor(ing)? (the|our)|redesign|migrate)\b/i,
  /\b(unclear|not sure| somehow|maybe|options?|trade-?offs?|which approach)\b/i,
  /\b(requirements?|spec|acceptance|verifiable|seed spec|interview)\b/i,
  /\b(ultraplan|ultra plan|structured plan|mission)\b/i,
];

/** Signals that the ask is scoped and already decided → Regular. */
const REGULAR_SIGNALS: readonly RegExp[] = [
  /\b(fix|bug|typo|nits?|hotfix|regression)\b/i,
  /\b(add|update|adjust|tweak|rename|move)\b.{0,60}\b(test|tests|docs?|comment|type|types|import)\b/i,
  /\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|md|yaml|yml|json)\b/,
  /\b(in|under|at)\s+[\w./-]{3,}\b/,
  /\b(only|just|single|one[- ]line|small)\b/i,
];

/**
 * Pick regular vs ultra. Explicit `ultra` always wins; otherwise score context.
 * Mission/Ultrawork source always ultra.
 */
export function resolvePlanModeKind(input: ResolvePlanModeKindInput): ResolvePlanModeKindResult {
  if (input.ultra === true) {
    return { kind: 'ultra', reason: 'explicit ultra=true' };
  }
  if (input.ultra === false) {
    return { kind: 'regular', reason: 'explicit ultra=false' };
  }
  if (input.source === 'ultrawork') {
    return { kind: 'ultra', reason: 'Mission/Ultrawork activation source' };
  }

  const ctx = (input.initialContext ?? '').trim();
  if (ctx.length === 0) {
    // No context: prefer regular so Conductor does not always pay interview cost;
    // model should pass ultra=true or a rich initial_context when structured planning is needed.
    return { kind: 'regular', reason: 'no initial_context — default regular (pass ultra=true for structured)' };
  }

  let ultraScore = 0;
  let regularScore = 0;
  const hits: string[] = [];

  for (const re of ULTRA_SIGNALS) {
    if (re.test(ctx)) {
      ultraScore += 1;
      hits.push(`ultra:${re.source.slice(0, 40)}`);
    }
  }
  for (const re of REGULAR_SIGNALS) {
    if (re.test(ctx)) {
      regularScore += 1;
      hits.push(`regular:${re.source.slice(0, 40)}`);
    }
  }

  // Long open-ended briefs without file anchors lean ultra (Ouroboros: vague → interview).
  if (ctx.length >= 280 && regularScore === 0) {
    ultraScore += 1;
    hits.push('ultra:long_open_brief');
  }
  // Many path mentions with short brief → regular.
  const pathMentions = ctx.match(/[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|md)/gi)?.length ?? 0;
  if (pathMentions >= 2 && ctx.length < 400) {
    regularScore += 1;
    hits.push('regular:multi_path_scoped');
  }

  if (ultraScore > regularScore) {
    return { kind: 'ultra', reason: `context signals favor ultra (${hits.slice(0, 4).join('; ')})` };
  }
  if (regularScore > ultraScore) {
    return { kind: 'regular', reason: `context signals favor regular (${hits.slice(0, 4).join('; ')})` };
  }
  // Tie: short → regular; longer → ultra (safer for ambiguity).
  if (ctx.length >= 160) {
    return { kind: 'ultra', reason: 'tie — longer brief defaults to ultra interview' };
  }
  return { kind: 'regular', reason: 'tie — short brief defaults to regular' };
}

/** Ultra may skip research when context is rich / greenfield (keep in sync with agent/plan/ultra-plan-start-phase). */
export function shouldSkipUltraResearchPhase(initialContext: string): boolean {
  const ctx = initialContext.trim();
  if (ctx.length >= 400) return true;
  if (/\b(from scratch|greenfield|new (game|app|product|cli)|build me)\b/i.test(ctx)) return true;
  if (/\b(based on|as discussed|prior context|handoff|recording|transcript)\b/i.test(ctx)) {
    return true;
  }
  return false;
}
