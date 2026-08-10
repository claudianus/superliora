/**
 * writing-for-agents quality gate for SkillCreate / auto skills.
 * Cheap lexical checks — reject bodies that cannot state done.
 */

export interface SkillWritingQualityIssue {
  readonly code: 'missing_completion_criterion' | 'negation_only' | 'empty_steps';
  readonly message: string;
}

/**
 * Returns issues that should block SkillCreate. Empty = ok.
 * Completion criterion: a checklist item, "Done when", or "Completion" bound.
 */
export function assessSkillWritingQuality(body: string): readonly SkillWritingQualityIssue[] {
  const text = body.trim();
  const issues: SkillWritingQualityIssue[] = [];
  if (text.length < 40) {
    issues.push({
      code: 'empty_steps',
      message: 'Skill body is too short — include ordered steps with a checkable completion criterion.',
    });
    return issues;
  }

  const hasCriterion =
    /\b(?:done when|completion(?:\s+criterion)?|success(?:\s+criteria)?|you(?:'re| are) done|finished when)\b/i.test(
      text,
    ) ||
    /(?:^|\n)\s*[-*]\s*\[[ xX]?\]\s+\S/.test(text) ||
    /(?:^|\n)##?\s*completion\b/i.test(text);

  if (!hasCriterion) {
    issues.push({
      code: 'missing_completion_criterion',
      message:
        'Skill body needs a checkable completion criterion (e.g. "Done when …", a ## Completion section, or a checklist). writing-for-agents: sharpen the bound before shipping.',
    });
  }

  // Heavy "don't / never / avoid" without a positive target nearby is a smell.
  const negationHits = text.match(/\b(?:don't|do not|never|avoid)\b/gi)?.length ?? 0;
  const positiveHits =
    text.match(/\b(?:do|write|run|prefer|use|emit|record|ask|call)\b/gi)?.length ?? 0;
  if (negationHits >= 4 && negationHits > positiveHits) {
    issues.push({
      code: 'negation_only',
      message:
        'Skill steers mostly by prohibition — rewrite with positive target behaviour (writing-for-agents).',
    });
  }

  return issues;
}

export function formatSkillWritingQualityFailure(
  issues: readonly SkillWritingQualityIssue[],
): string {
  return [
    'SkillCreate rejected — writing-for-agents quality gate:',
    ...issues.map((i) => `- ${i.message}`),
  ].join('\n');
}
