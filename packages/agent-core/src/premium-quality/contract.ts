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
  '- Trigger: any web/app UI, landing, dashboard, game surface, marketing site, component library, or visual refresh — even without the word "design".',
  '- Before visual markup/styles or shipping a visible slice: SearchSkill → Skill best match. Reuse loaded skills; do not reload the same skill.',
  '- Keywords (3–12 words): "frontend design distinctive anti template"; "premium frontend design taste anti slop"; "redesign existing project premium visual audit"; "minimalist ui premium utilitarian design"; "stitch design taste semantic design system"; "develop web game visual polish playwright screenshot"; "workspace imagen generate ui assets icons".',
  '- Subject-specific assets: GenerateImage when OPENAI_API_KEY or GOOGLE_API_KEY/GEMINI_API_KEY is set; otherwise SearchSkill → workspace-imagen.',
  '- Load ≥1 visual skill before the first visual implementation pass. For games, load develop-web-game plus a design skill.',
  '- Skill text is constraints, not optional inspiration. AGENTS.md and harness contracts override conflicts.',
].join('\n');

export const PREMIUM_VISUAL_SKIP_SKILL_WHEN = [
  'Skip Premium Visual skill loads only when:',
  '- Backend/CLI/infra/data work with zero user-visible surface change.',
  '- Non-visual config/docs with no rendered UI impact.',
  '- The matching visual skill is already loaded in context.',
].join('\n');

/** Compact reminder injected on sparse premium turns. */
export const PREMIUM_VISUAL_SPARSE_CHECKPOINT =
  'Premium Visual still ON — art direction before code; SearchSkill → frontend-design if needed; GenerateImage for custom assets when keys exist; BrowserScreenshot before done; use picsum/dicebear/font stacks/bento templates.';
