import { globMatch } from './path-glob-match';

const GLOB_LITERAL_SPECIAL = /[\\*?[\]{}()!+@|]/g;

export function literalRulePattern(toolName: string, subject: string): string {
  return `${toolName}(${escapeRuleSubjectLiteral(subject)})`;
}

export function escapeRuleSubjectLiteral(subject: string): string {
  return subject.replace(GLOB_LITERAL_SPECIAL, '\\$&');
}

export function matchesGlobRuleSubject(ruleArgs: string, subject: string): boolean {
  return matchRuleSubjects(ruleArgs, [subject], (pattern, value) => globMatch(value, pattern));
}

function matchRuleSubjects(
  ruleArgs: string,
  subjects: readonly string[],
  matchesPositivePattern: (pattern: string, subject: string) => boolean,
): boolean {
  if (ruleArgs.length === 0) return true;
  const negated = ruleArgs.startsWith('!');
  const positivePattern = negated ? ruleArgs.slice(1) : ruleArgs;
  const hit = subjects.some((subject) => matchesPositivePattern(positivePattern, subject));
  return negated ? !hit : hit;
}
