/**
 * Model-visible budget for loaded skill bodies.
 *
 * Catalog skills can be 30–140KB. Those bodies are appended as user messages
 * and stay in history on every later LLM call, so an uncapped load dominates
 * the window until compaction. Keep the head (workflow lives at the top) and
 * point at the on-disk SKILL.md for the rest.
 */

export const SKILL_INJECTION_MAX_CHARS = 32_000;

export function budgetSkillContentForInjection(
  content: string,
  skillPath?: string,
): string {
  if (content.length <= SKILL_INJECTION_MAX_CHARS) return content;
  const where =
    skillPath !== undefined && skillPath.length > 0
      ? ` Read the rest from ${skillPath}.`
      : ' Read the rest from the skill path on disk.';
  const notice = `\n\n[Skill body truncated to ${String(SKILL_INJECTION_MAX_CHARS)} characters to protect context.${where}]`;
  const keep = Math.max(0, SKILL_INJECTION_MAX_CHARS - notice.length);
  return `${content.slice(0, keep)}${notice}`;
}
