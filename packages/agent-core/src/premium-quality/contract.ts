/** Builtin skill names — discover via SearchSkill; never hardcode locale skills in prompts. */
export const PREMIUM_VISUAL_SKILL_NAMES = {
  frontendDesign: 'frontend-design',
  designTaste: 'design-taste-frontend',
  redesign: 'redesign-existing-projects',
  minimalistUi: 'minimalist-ui',
  stitchDesign: 'stitch-design-taste',
  webGame: 'develop-web-game',
  imagen: 'workspace-imagen',
} as const;

export type PremiumVisualSkillName =
  (typeof PREMIUM_VISUAL_SKILL_NAMES)[keyof typeof PREMIUM_VISUAL_SKILL_NAMES];

/** Premium Visual skill routing is mandatory for visible-surface work while Premium Quality is ON. */
export const PREMIUM_VISUAL_SKILL_ROUTING = [
  'Premium Visual skill routing (MANDATORY while Premium Quality is ON):',
  '- Trigger: any web/app UI, landing page, dashboard, game surface, marketing site, component library, or visual refresh — even if the user did not say "design" or "premium".',
  '- Before writing visual markup/styles or shipping a visible slice, SearchSkill → Skill for the best match. Reuse loaded skill content; do not reload the same skill.',
  '- Surface → SearchSkill keywords (English, 3–12 words):',
  '  - Any new visible UI (load FIRST): "frontend design distinctive anti template anthropic"',
  '  - New web UI / React / Next / Tailwind: "premium frontend design taste anti slop"',
  '  - Upgrade existing site: "redesign existing project premium visual audit"',
  '  - Editorial / minimal product UI: "minimalist ui premium utilitarian design"',
  '  - Design system / Stitch brief: "stitch design taste semantic design system"',
  '  - Browser game / canvas HUD: "develop web game visual polish playwright screenshot"',
  '  - Missing icons/hero/illustrations: "workspace imagen generate ui assets icons"',
  '  - Unsure: SearchSkill "premium visual web design anti generic" → Skill the top hit',
  '- Load at least one visual skill before the first visual implementation pass. For games, load develop-web-game plus a design skill.',
  '- Treat skill text as engineering constraints, not optional inspiration. AGENTS.md and harness contracts override conflicts.',
].join('\n');

export const PREMIUM_VISUAL_SKIP_SKILL_WHEN = [
  'Skip Premium Visual skill loads only when:',
  '- The turn is backend-only, CLI-only, infra, or data work with zero user-visible surface change.',
  '- You are editing non-visual config/docs with no rendered UI impact.',
  '- The matching visual skill is already loaded in context.',
].join('\n');

/** Compact reminder injected on sparse premium turns. */
export const PREMIUM_VISUAL_SPARSE_CHECKPOINT =
  'Premium Visual still ON — use embedded refs (picsum seeds, dicebear, font stacks, bento/split templates), art direction before code, SearchSkill → frontend-design if not loaded, BrowserScreenshot before done.';
