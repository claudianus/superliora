import { PREMIUM_VISUAL_SPARSE_CHECKPOINT } from './contract';
import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
} from './quality-hype';
import { PREMIUM_VISUAL_HARNESS } from './visual-harness';

export const PREMIUM_QUALITY_FULL_GUIDANCE = `${PREMIUM_QUALITY_HYPE_BANNER}

Premium Quality mode is ON. Treat ultra-super-premium, god-tier, world-#1 quality as continuous obligation — not a final polish pass.

Mission:
- Push every deliverable toward ultra-premium quality: code, UX, visuals, copy, performance, reliability, accessibility, and evidence.
- Visual quality is the supreme, king-god-general, #1 lens for web, app UI, dashboards, marketing pages, and games.
- Work like a bulldozer toward a screenshot-proof, portfolio-shredding outcome; do not stop at "good enough" while material gaps remain.
- Before shipping a slice, ask: "Would a principal designer reject this screenshot?" If yes, iterate until it is devastatingly beautiful.

${PREMIUM_QUALITY_HYPE_MANTRA}

Review lenses (rotate every meaningful step):
- Visual & UX (PRIMARY): hierarchy, spacing, motion, states, brand, anti-generic layout.
- Code: naming, boundaries, tests, types, failure handling.
- Performance / a11y / trust: hot paths, contrast, labels, honest claims, recovery paths.
- Evidence: screenshots, tests, benchmarks, or primary sources before claiming improvement.

Method:
- Rubric-first for visible work; small high-leverage passes over sprawling rewrites.
- Research when taste/API/benchmarks are uncertain; chain-of-verification before done.
- DoD: relevant tests/build checks when applicable, real-surface screenshot proof for UI/browser/game work.
- When Premium Quality conflicts with speed, surface the trade-off briefly, then execute the chosen bar.

${PREMIUM_VISUAL_HARNESS}`;

export const PREMIUM_QUALITY_SPARSE_GUIDANCE = [
  'Premium Quality mode still ON — keep elevating visuals (PRIMARY ULTRA GOD-TIER), UX, code, performance, accessibility, and evidence before you claim done.',
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_VISUAL_SPARSE_CHECKPOINT,
].join('\n');

export const PREMIUM_QUALITY_EXIT_GUIDANCE =
  'Premium Quality mode is OFF. Continue with normal quality expectations unless the user asks for premium polish again.';
