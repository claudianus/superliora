/**
 * Whether Ultra Plan may start at interview (skip research).
 * Kept in agent/plan to avoid agent→tools layering for PlanMode.enter.
 * Criteria mirrored in resolve-plan-mode-kind for tool-layer callers.
 */

export function shouldSkipUltraResearchPhase(initialContext: string): boolean {
  const ctx = initialContext.trim();
  if (ctx.length >= 400) return true;
  if (/\b(from scratch|greenfield|new (game|app|product|cli)|build me)\b/i.test(ctx)) return true;
  if (/\b(based on|as discussed|prior context|handoff|recording|transcript)\b/i.test(ctx)) {
    return true;
  }
  return false;
}
