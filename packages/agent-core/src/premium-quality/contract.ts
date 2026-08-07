/** Builtin skill names — discover via SearchSkill; never hardcode locale skills in prompts. */
export const PREMIUM_VISUAL_SKILL_NAMES = {
  /** SuperLiora harness craft (rubric/playbook/refs) — load first under PQ visual density. */
  harness: 'premium-visual',
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
  '- Trigger: any web/app UI, landing, dashboard, game, marketing site, component library, or visual refresh — even without "design".',
  '- Before first visual markup: Skill("premium-visual") (harness rubric/playbook/refs). Then SearchSkill → Skill a secondary taste skill if needed.',
  '- Keywords (3–12 words): "frontend design distinctive anti template"; "premium frontend design taste anti slop"; "redesign visual audit"; "minimalist ui premium"; "stitch design system"; "web game polish playwright"; "workspace imagen ui assets".',
  '- Assets: GenerateImage when OPENAI/GOOGLE/GEMINI keys exist; else SearchSkill → workspace-imagen.',
  '- Games: develop-web-game + premium-visual (and a design skill when art direction is thin).',
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
  'Premium Visual still ON — art direction before code; Skill("premium-visual") if not loaded; BrowserScreenshot / VerifySurface before done; picsum/dicebear/font stacks OK.';
