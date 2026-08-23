/**
 * One routing doctrine for Memory, SkillCreate, Refine, and auto-skillify.
 * Keep the stores separate; make every writer say the same split.
 */
export const LEARNING_LANES = [
  'Learning lanes (pick one; do not duplicate):',
  '- Memory: facts, preferences, decisions, reminders. One or two sentences. Not a numbered playbook.',
  '- Skill: a recurring procedure with exact steps/commands. SearchSkill then Skill(). Failed path + what worked.',
  '- Prompt note: a short always-on habit for this harness (Refine). Not a repo-wide rule.',
  '- AGENTS.md: standing project rules (build, layout, tests). Humans write these; do not auto-edit.',
  '- Drop: one-off fixes, generic retries, catalog workflows already covered by builtin skills.',
].join('\n');
