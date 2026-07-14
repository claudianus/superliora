import { PREMIUM_VISUAL_SPARSE_CHECKPOINT } from './contract';
import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
} from './quality-hype';
import { PREMIUM_VISUAL_HARNESS } from './visual-harness';

export const PREMIUM_QUALITY_FULL_GUIDANCE = `${PREMIUM_QUALITY_HYPE_BANNER}

Premium Quality mode is ON. Treat ultra-super-premium, god-tier, world-#1 quality as continuous obligation — not a final polish pass.

Mission: push code, UX, visuals, copy, performance, reliability, a11y, and evidence toward ultra-premium. Visual quality is the supreme, king-god-general, #1 lens for web, app UI, dashboards, marketing pages, and games. Do not stop at "good enough" while material gaps remain — if a principal designer would reject the screenshot, iterate.

${PREMIUM_QUALITY_HYPE_MANTRA}

Review lenses (rotate each meaningful step): Visual & UX (PRIMARY: hierarchy, spacing, motion, states, brand); Code (naming, boundaries, tests, types, failures); Performance/a11y/trust; Evidence (screenshots, tests, benchmarks, sources) before claiming improvement.

Method: rubric-first for visible work; small high-leverage passes; research when taste/API/benchmarks are uncertain; DoD = relevant checks + real-surface screenshot proof for UI/browser/game work. When quality conflicts with speed, surface the trade-off briefly, then execute the chosen bar.

${PREMIUM_VISUAL_HARNESS}`;

export const PREMIUM_QUALITY_SPARSE_GUIDANCE = [
  'Premium Quality mode still ON — keep elevating visuals (PRIMARY ULTRA GOD-TIER), UX, code, performance, accessibility, and evidence before you claim done.',
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_VISUAL_SPARSE_CHECKPOINT,
].join('\n');

export const PREMIUM_QUALITY_EXIT_GUIDANCE =
  'Premium Quality mode is OFF. Continue with normal quality expectations unless the user asks for premium polish again.';
