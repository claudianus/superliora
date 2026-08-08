import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
} from './quality-hype';
import { classifyObjectiveProfile } from './ui-surface';
import { PREMIUM_VISUAL_HARNESS } from './visual-harness';

const PREMIUM_QUALITY_CORE_GUIDANCE = `${PREMIUM_QUALITY_HYPE_BANNER}

Premium Quality mode is ON. Treat screenshot-proof craft as continuous — not a final polish pass. Raise quality inside scope; do not inflate features for spectacle.

Mission:
- Push deliverables toward durable premium quality: code, UX, visuals, copy, performance, reliability, accessibility, and evidence.
- For web, app UI, dashboards, marketing pages, and games, visual quality is the primary lens — what humans see must look intentional.
- Do not stop at "good enough", "fine", or "MVP-looking" while a material craft gap remains inside the stated goal.
- Before shipping a slice, ask: "Would a principal designer reject this screenshot as placeholder/generic?" If yes, iterate craft — do not invent scope.

${PREMIUM_QUALITY_HYPE_MANTRA}

Multi-lens review (rotate every meaningful step):
- Visual & UX (PRIMARY — ULTRA PREMIUM): hierarchy, spacing, motion, feedback, empty/error states, readability, brand consistency, asset quality, anti-generic layout — all at hyper-polished, luxury-grade standard.
- Code quality: naming, boundaries, tests, types, dead-code removal, failure handling, observability — impeccably clean.
- Performance: hot paths, bundle/size, latency, memory, unnecessary work, caching where evidence supports it — blazing and refined.
- Accessibility: keyboard flow, contrast, labels, focus order, screen-reader text, touch targets — flawless inclusive craft.
- Product & trust: clarity of value, honest claims, security/privacy posture, recovery paths, edge cases — premium-trustworthy.
- Evidence: screenshots, tests, benchmarks, or primary sources before claiming improvement — screenshot-proof or it did not happen.

Methodology (apply actively):
- Rubric-first: define screenshot-proof craft for this task, then iterate until the rubric passes — especially the Premium Visual rubric for visible work.
- Research-backed upgrades: WebSearch/FetchURL for current best practices, design references, and benchmarks when uncertain.
- Chain-of-verification: after a draft answer or implementation plan, list likely failure modes and verify or fix them.
- Small high-leverage passes: prefer focused craft iterations over sprawling rewrites or scope inflate.
- Prompt-quality discipline for user-visible text: specific claims, concrete nouns/verbs, no template slop; match response_language.
- Definition of Done: relevant tests, lint/typecheck/build when applicable, real-surface screenshot verification for UI/browser/game work — intentional craft or not done.

Execution stance:
- Propose upgrade paths when they materially improve outcomes; preserve user agency with baseline/defer options.
- When Premium Quality conflicts with speed, surface the trade-off briefly, then execute the chosen craft bar inside scope.
- Record durable quality decisions in the plan, todos, or evidence ledger — not only in chat.`;

export const PREMIUM_QUALITY_FULL_GUIDANCE = `${PREMIUM_QUALITY_CORE_GUIDANCE}

${PREMIUM_VISUAL_HARNESS}`;

/**
 * Prompt diet (harness reform T2-2): the ~3KB visual harness (rubric,
 * playbook, refs) is on demand, not re-injected. Sessions keep the core
 * quality bar plus a pointer to load the full craft guidance via skill.
 */
export const PREMIUM_VISUAL_ON_DEMAND_POINTER = [
  'Premium Visual harness is on demand (T2-2): before first visual markup, Skill("premium-visual") — SuperLiora art direction, rubric, playbook, banned ship states, and compact refs live there.',
  'Secondary taste skills (frontend-design, design-taste-frontend, …) load after premium-visual when needed. Do not re-dump the full harness into context.',
  'Verify visible surfaces with BrowserScreenshot / VerifySurface before claiming done; record the evidence path.',
].join('\n');

export const PREMIUM_QUALITY_VISUAL_INJECTION_GUIDANCE = `${PREMIUM_QUALITY_CORE_GUIDANCE}

${PREMIUM_VISUAL_ON_DEMAND_POINTER}`;

export const PREMIUM_QUALITY_SPARSE_GUIDANCE = [
  'Premium Quality still ON (visual density) — hold the ultra-premium bar on user-visible surfaces; screenshot-verify before claiming done.',
  'Full craft guidance is on demand: Skill("premium-visual") before first markup if not already loaded.',
].join('\n');

/**
 * Non-visual Premium density: Goal runs often force Premium ON for backend/CLI/infra.
 * Keep code/evidence bar without the full visual harness flood.
 */
export const PREMIUM_QUALITY_CODE_FULL_GUIDANCE = [
  'Premium Quality ON (code/evidence density — no visible UI in the active objective).',
  'Raise correctness, tests, types, failure handling, performance, and security toward ultra-premium, engineer-respecting quality. Prefer small high-leverage diffs.',
  'DoD: inspect relevant files/tests; focused verification; finish with evidence (tests, typecheck, real CLI/API proof) and remaining risks.',
  'Harness force: SearchSkill→Skill for domain workflows; WebSearch/Context7/FetchURL for freshness; dedicated tools over Bash; parallelize independent calls.',
  'If work later adds a user-visible surface, switch to visual Premium: art direction, anti-slop, screenshot proof, intentional craft.',
  'Skip frontend design skill loads while there is zero user-visible surface change.',
].join('\n');

export const PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE =
  'Premium still ON (code/evidence) — keep correctness, tests, types, real-surface verification tight; no visual harness while non-visual.';

export const PREMIUM_QUALITY_EXIT_GUIDANCE =
  'Premium Quality mode is OFF. Continue with normal quality expectations unless the user re-requests premium polish.';

export type PremiumInjectionDensity = 'visual' | 'code';
/** Prefer a cached/LLM objective profile; fall back to UI heuristics. */
export function detectPremiumVisualSurface(
  objective: string,
  profile?: { readonly visualSurface?: boolean; readonly premiumDensity?: PremiumInjectionDensity },
): boolean {
  if (profile?.premiumDensity === 'visual' || profile?.visualSurface === true) return true;
  if (profile?.premiumDensity === 'code' || profile?.visualSurface === false) return false;
  return classifyObjectiveProfile(objective).visualSurface;
}

/**
 * Resolve injection density for an active Premium session.
 * Prefer a cached profile; otherwise classify the objective with UI heuristics.
 */
export function resolvePremiumInjectionDensity(
  objective: string | undefined | null,
  profile?: { readonly premiumDensity?: PremiumInjectionDensity; readonly visualSurface?: boolean },
): PremiumInjectionDensity {
  if (profile?.premiumDensity === 'visual' || profile?.premiumDensity === 'code') {
    return profile.premiumDensity;
  }
  if (profile?.visualSurface === true) return 'visual';
  if (profile?.visualSurface === false) return 'code';
  return classifyObjectiveProfile(objective).premiumDensity;
}

export function selectPremiumFullGuidance(density: PremiumInjectionDensity): string {
  return density === 'visual'
    ? PREMIUM_QUALITY_VISUAL_INJECTION_GUIDANCE
    : PREMIUM_QUALITY_CODE_FULL_GUIDANCE;
}

export function selectPremiumSparseGuidance(density: PremiumInjectionDensity): string {
  return density === 'visual' ? PREMIUM_QUALITY_SPARSE_GUIDANCE : PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE;
}
