import { PREMIUM_VISUAL_SPARSE_CHECKPOINT } from './contract';
import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
} from './quality-hype';
import { PREMIUM_VISUAL_HARNESS } from './visual-harness';

export const PREMIUM_QUALITY_FULL_GUIDANCE = `${PREMIUM_QUALITY_HYPE_BANNER}

Premium Quality mode is ON. Treat premium, screenshot-proof quality as a continuous obligation — not a final polish pass.

Mission: push code, UX, visuals, copy, performance, reliability, a11y, and evidence toward premium. Visual quality is the primary lens for web, app UI, dashboards, marketing pages, and games. If a principal designer would reject the screenshot, iterate.

${PREMIUM_QUALITY_HYPE_MANTRA}

Review lenses (rotate each meaningful step): Visual & UX (PRIMARY: hierarchy, spacing, motion, states, brand); Code (naming, boundaries, tests, types, failures); Performance/a11y/trust; Evidence (screenshots, tests, benchmarks, sources) before claiming improvement.

Method: rubric-first for visible work; small high-leverage passes; research when taste/API/benchmarks are uncertain; DoD = relevant checks + real-surface screenshot proof for UI/browser/game work. When quality conflicts with speed, surface the trade-off briefly, then execute the chosen bar.

${PREMIUM_VISUAL_HARNESS}`;

export const PREMIUM_QUALITY_SPARSE_GUIDANCE = [
  'Premium Quality mode still ON — keep elevating visuals (PRIMARY), UX, code, performance, accessibility, and evidence before you claim done.',
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_VISUAL_SPARSE_CHECKPOINT,
].join('\n');

/**
 * Non-visual Premium density: Ultrawork/Goal often force Premium ON for backend/CLI/infra.
 * Keep code/evidence bar without the full visual harness flood.
 */
export const PREMIUM_QUALITY_CODE_FULL_GUIDANCE = [
  'Premium Quality mode is ON (code/evidence density — no visible UI surface detected in the active objective).',
  'Raise code quality, correctness, tests, types, failure handling, performance, and security. Prefer small high-leverage diffs.',
  'DoD: inspect relevant files/tests first; run focused verification; finish only with evidence (test output, typecheck, real CLI/API proof) and remaining risks.',
  'If the work later adds a user-visible surface (web/app/dashboard/game), switch to visual Premium bar: art direction, anti-slop, screenshot proof.',
  'Skip frontend design skill loads while there is zero user-visible surface change.',
].join('\n');

export const PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE =
  'Premium Quality still ON (code/evidence density) — keep correctness, tests, types, and real-surface verification tight; no visual harness while the objective stays non-visual.';

export const PREMIUM_QUALITY_EXIT_GUIDANCE =
  'Premium Quality mode is OFF. Continue with normal quality expectations unless the user asks for premium polish again.';

/** Same visual-surface heuristic as Ultrawork capability detection (keep in sync). */
const PREMIUM_VISUAL_SURFACE_PATTERN =
  /\b(?:ui|ux|visual|screen|canvas|animation|motion|layout|design|brand|game|interactive|browser|dashboard|frontend|css|webpage|website|landing)\b|(?:시각|비주얼|화면|캔버스|애니메이션|레이아웃|디자인|브랜드|게임|인터랙티브|브라우저|대시보드|프론트|웹페이지|랜딩)/i;

export type PremiumInjectionDensity = 'visual' | 'code';

/**
 * Returns whether the objective implies a user-visible surface that needs the full visual harness.
 */
export function detectPremiumVisualSurface(objective: string): boolean {
  return PREMIUM_VISUAL_SURFACE_PATTERN.test(objective);
}

/**
 * Resolve injection density for an active Premium session.
 * - No goal/ultrawork objective (manual Premium): keep full visual bar.
 * - Objective with visual surface signals: visual.
 * - Otherwise: code/evidence compact density.
 */
export function resolvePremiumInjectionDensity(objective: string | undefined | null): PremiumInjectionDensity {
  const text = objective?.trim() ?? '';
  if (text.length === 0) return 'visual';
  return detectPremiumVisualSurface(text) ? 'visual' : 'code';
}

export function selectPremiumFullGuidance(density: PremiumInjectionDensity): string {
  return density === 'visual' ? PREMIUM_QUALITY_FULL_GUIDANCE : PREMIUM_QUALITY_CODE_FULL_GUIDANCE;
}

export function selectPremiumSparseGuidance(density: PremiumInjectionDensity): string {
  return density === 'visual' ? PREMIUM_QUALITY_SPARSE_GUIDANCE : PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE;
}
