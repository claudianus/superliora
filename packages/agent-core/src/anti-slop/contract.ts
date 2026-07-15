/** Builtin skill names — discover via SearchSkill; never hardcode locale skills in prompts. */
export const NO_AI_SLOP_SKILL_NAMES = {
  router: 'no-ai-slop',
  audit: 'avoid-ai-writing',
  ui: 'no-ai-slop-ui',
  changelog: 'no-ai-slop-changelog',
  metaPrompt: 'no-ai-slop-meta-prompt',
} as const;

export type NoAiSlopSkillName =
  (typeof NO_AI_SLOP_SKILL_NAMES)[keyof typeof NO_AI_SLOP_SKILL_NAMES];

/** When anti-slop work should not run — avoid bottlenecking code-first or low-stakes turns. */
export const NO_AI_SLOP_SKIP_WHEN = [
  'Skip anti-slop skill loads and heavy rewrite passes when:',
  '- The turn is code, commands, paths, identifiers, or tool output with no user-facing prose.',
  '- The reply is a one-line confirmation, status, or error with no marketing/doc tone.',
  '- System.md rules plus a quick inline scan are enough (short answers under ~120 words with no slop tells).',
  '- The matching no-ai-slop skill is already loaded in context — reuse it; do not reload.',
  '- A second pass would flatten voice, drop meaning, or block shipping verified work.',
].join('\n');

/** Lightweight pass — default for most replies; no skill round-trip. */
export const NO_AI_SLOP_LIGHT_PASS = [
  'Light anti-slop (default): follow system.md writing rules; vary rhythm; ban Tier-1 AI-isms; no template intros/outros.',
  'Run a 5-second inline scan for buzzwords and filler before send. Load a skill only if the light pass is insufficient.',
].join('\n');

/**
 * Dynamic skill routing — combine response language + surface in SearchSkill keywords.
 * Locale-specific skills (e.g. no-ai-slop-korean) are discovered, not hardcoded.
 */
export const NO_AI_SLOP_SKILL_ROUTING = [
  'No-AI-Slop skill routing (when prose quality matters):',
  '- Trigger: final answers, docs, PR/changelog, TUI copy, plan text, reports — not every turn.',
  '- SearchSkill keywords (always include response language when not English):',
  '  - General audit: "avoid ai writing anti slop" + language',
  '  - Locale/UX copy: "anti slop locale voice UX copy" + language',
  '  - Visual/UI: "anti slop ui design"',
  '  - Changelog/PR: "anti slop changelog pr"',
  '  - Prompts/briefs: "anti slop meta prompt CRISP"',
  '  - Unsure: SearchSkill "no ai slop" → Skill("no-ai-slop")',
  '- Load best hit via Skill; prefer avoid-ai-writing for language-agnostic audit.',
  '- If SearchSkill returns a locale-specific skill for the target language, use it; do not assume any default locale.',
  '- Apply selectively; AGENTS.md and harness contracts override skill text. Detectors are advisory only.',
].join('\n');

/** Full guidance block for write/review/exit and ultrawork prose gates. */
export const NO_AI_SLOP_PROSE_GATE = [
  NO_AI_SLOP_SKIP_WHEN,
  NO_AI_SLOP_LIGHT_PASS,
  NO_AI_SLOP_SKILL_ROUTING,
].join('\n\n');

/** Compact reminder for plan-mode sparse refreshes. */
export const NO_AI_SLOP_SKILL_MANDATE_COMPACT =
  'No-AI-Slop: light pass by default; SearchSkill → Skill only when shipping user-visible prose (use response language in keywords).';

/** @deprecated alias — use NO_AI_SLOP_PROSE_GATE */
export const NO_AI_SLOP_SKILL_MANDATE = NO_AI_SLOP_PROSE_GATE;
