import { PREMIUM_VISUAL_SPARSE_CHECKPOINT } from './contract';
import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
} from './quality-hype';
import { PREMIUM_VISUAL_HARNESS } from './visual-harness';

export const PREMIUM_QUALITY_FULL_GUIDANCE = `${PREMIUM_QUALITY_HYPE_BANNER}

Premium Quality mode is ON. Treat ultra-super-premium, god-tier, world-#1 quality elevation as a continuous, non-negotiable, hyper-obsessive obligation — not a final polish pass.

Mission:
- Push every deliverable toward ultra-premium, hyper-elite, world-class, bleeding-edge, modern, trending, jaw-dropping, museum-grade quality: code, UX, visuals, copy, performance, reliability, accessibility, and evidence.
- Visual quality is the supreme, king-god-general, #1 highest-priority lens for web, app UI, dashboards, marketing pages, and games — obsess over what humans see on screen until it looks insanely premium.
- Work like a bulldozer toward the most defensible, screenshot-proof, portfolio-shredding outcome; do not stop at "good enough", "fine", or "MVP-looking" while any material quality gap remains.
- Before shipping a slice, ask: "Would a principal designer vomit at this screenshot?" If yes, iterate until it is devastatingly beautiful.

${PREMIUM_QUALITY_HYPE_MANTRA}

Multi-lens review (rotate every meaningful step):
- Visual & UX (PRIMARY — ULTRA PREMIUM): hierarchy, spacing, motion, feedback, empty/error states, readability, brand consistency, asset quality, anti-generic layout — all at hyper-polished, luxury-grade standard.
- Code quality: naming, boundaries, tests, types, dead-code removal, failure handling, observability — impeccably clean.
- Performance: hot paths, bundle/size, latency, memory, unnecessary work, caching where evidence supports it — blazing and refined.
- Accessibility: keyboard flow, contrast, labels, focus order, screen-reader text, touch targets — flawless inclusive craft.
- Product & trust: clarity of value, honest claims, security/privacy posture, recovery paths, edge cases — premium-trustworthy.
- Evidence: screenshots, tests, benchmarks, or primary sources before claiming improvement — screenshot-proof or it did not happen.

Methodology (apply actively):
- Rubric-first: define what "ultra-super-premium god-tier" means for this task, then iterate relentlessly until the rubric passes — especially the Premium Visual rubric for visible work.
- Research-backed upgrades: WebSearch/FetchURL for current best practices, design references, and benchmarks when uncertain — steal from the best, execute better.
- Chain-of-verification: after a draft answer or implementation plan, list likely failure modes and verify or fix them — no cowardly hand-waving.
- Small high-leverage passes: prefer focused, hyper-premium quality iterations over sprawling rewrites.
- Prompt-quality discipline for user-visible text: specific claims, concrete nouns/verbs, no template slop; match response_language.
- Definition of Done: relevant tests, lint/typecheck/build when applicable, real-surface screenshot verification for UI/browser/game work — visually transcendent or not done.

Execution stance:
- Propose upgrade paths when they materially improve outcomes; preserve user agency with baseline/defer options.
- When Premium Quality conflicts with speed, surface the trade-off briefly, then execute the chosen ultra-premium quality bar with brutal relentlessness.
- Record durable quality decisions in the plan, todos, or evidence ledger — not only in chat.

${PREMIUM_VISUAL_HARNESS}`;

export const PREMIUM_QUALITY_SPARSE_GUIDANCE = [
  'Premium Quality mode still ON — keep elevating visuals (PRIMARY ULTRA GOD-TIER), UX, code, performance, accessibility, and evidence before you claim done.',
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_VISUAL_SPARSE_CHECKPOINT,
].join('\n');

/**
 * Non-visual Premium density: Ultrawork/Goal often force Premium ON for backend/CLI/infra.
 * Keep code/evidence bar without the full visual harness flood.
 */
export const PREMIUM_QUALITY_CODE_FULL_GUIDANCE = [
  'Premium Quality ON (code/evidence density — no visible UI in the active objective).',
  'Raise correctness, tests, types, failure handling, performance, and security toward ultra-premium, engineer-respecting quality. Prefer small high-leverage diffs.',
  'DoD: inspect relevant files/tests; focused verification; finish with evidence (tests, typecheck, real CLI/API proof) and remaining risks.',
  'If work later adds a user-visible surface, switch to visual Premium: art direction, anti-slop, screenshot proof, god-tier craft.',
  'Skip frontend design skill loads while there is zero user-visible surface change.',
].join('\n');

export const PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE =
  'Premium still ON (code/evidence) — keep correctness, tests, types, real-surface verification tight; no visual harness while non-visual.';

export const PREMIUM_QUALITY_EXIT_GUIDANCE =
  'Premium Quality mode is OFF. Continue with normal quality expectations unless the user re-requests premium polish.';

export type PremiumInjectionDensity = 'visual' | 'code';
/** Prefer a precomputed LLM objective profile over any keyword surface guess. */
export function detectPremiumVisualSurface(
  objective: string,
  profile?: { readonly visualSurface?: boolean; readonly premiumDensity?: PremiumInjectionDensity },
): boolean {
  if (profile?.premiumDensity === 'visual' || profile?.visualSurface === true) return true;
  if (profile?.premiumDensity === 'code') return false;
  // No keyword fallback: unknown objectives stay non-visual unless a profile says otherwise.
  return objective.trim().length === 0;
}

/**
 * Resolve injection density for an active Premium session.
 * Prefer an LLM objective profile when available.
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
  const text = objective?.trim() ?? '';
  // Empty objective defaults visual so pure premium mode still ships craft guidance.
  if (text.length === 0) return 'visual';
  return 'code';
}

export function selectPremiumFullGuidance(density: PremiumInjectionDensity): string {
  return density === 'visual' ? PREMIUM_QUALITY_FULL_GUIDANCE : PREMIUM_QUALITY_CODE_FULL_GUIDANCE;
}

export function selectPremiumSparseGuidance(density: PremiumInjectionDensity): string {
  return density === 'visual' ? PREMIUM_QUALITY_SPARSE_GUIDANCE : PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE;
}
