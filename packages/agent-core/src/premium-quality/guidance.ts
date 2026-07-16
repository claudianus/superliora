import { PREMIUM_VISUAL_SPARSE_CHECKPOINT } from './contract';
import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
} from './quality-hype';
import { PREMIUM_VISUAL_HARNESS } from './visual-harness';

export const PREMIUM_QUALITY_FULL_GUIDANCE = `${PREMIUM_QUALITY_HYPE_BANNER}

Premium Quality is ON. Treat premium, screenshot-proof quality as continuous — not final polish.

Mission: raise code, UX, visuals, copy, performance, reliability, a11y, and evidence. Visual is primary for web/app/dashboard/game surfaces. If a principal designer would reject the screenshot, iterate.

${PREMIUM_QUALITY_HYPE_MANTRA}

Review lenses (rotate each step): Visual/UX (PRIMARY); Code (names, boundaries, tests, types, failures); Performance/a11y/trust; Evidence before claims.

Method: rubric-first for visible work; small high-leverage passes; research when uncertain; DoD = relevant checks + real-surface screenshot proof for UI/browser/game. When quality conflicts with speed, note the trade-off and execute.

${PREMIUM_VISUAL_HARNESS}`;

export const PREMIUM_QUALITY_SPARSE_GUIDANCE = [
  'Premium still ON — elevate visuals (PRIMARY), UX, code, performance, a11y, and evidence before done.',
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_VISUAL_SPARSE_CHECKPOINT,
].join('\n');

/**
 * Non-visual Premium density: Ultrawork/Goal often force Premium ON for backend/CLI/infra.
 * Keep code/evidence bar without the full visual harness flood.
 */
export const PREMIUM_QUALITY_CODE_FULL_GUIDANCE = [
  'Premium Quality ON (code/evidence density — no visible UI in the active objective).',
  'Raise correctness, tests, types, failure handling, performance, and security. Prefer small high-leverage diffs.',
  'DoD: inspect relevant files/tests; focused verification; finish with evidence (tests, typecheck, real CLI/API proof) and remaining risks.',
  'If work later adds a user-visible surface, switch to visual Premium: art direction, anti-slop, screenshot proof.',
  'Skip frontend design skill loads while there is zero user-visible surface change.',
].join('\n');

export const PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE =
  'Premium still ON (code/evidence) — keep correctness, tests, types, real-surface verification tight; no visual harness while non-visual.';

export const PREMIUM_QUALITY_EXIT_GUIDANCE =
  'Premium Quality mode is OFF. Continue with normal quality expectations unless the user re-requests premium polish.';

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
