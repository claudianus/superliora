/**
 * writing-for-agents quality gate for SkillCreate / auto skills.
 * Cheap lexical checks — reject bodies that cannot state done, cannot be
 * found later via SearchSkill, or are generic retry templates.
 */

export interface SkillWritingQualityIssue {
  readonly code:
    | 'missing_completion_criterion'
    | 'negation_only'
    | 'empty_steps'
    | 'generic_template'
    | 'not_searchable'
    | 'no_actionable_steps';
  readonly message: string;
}

interface SkillWritingQualityMeta {
  readonly description?: string | undefined;
  readonly whenToUse?: string | undefined;
}

/**
 * Returns issues that should block SkillCreate. Empty = ok.
 * Completion criterion: a checklist item, "Done when", or "Completion" bound.
 */
export function assessSkillWritingQuality(
  body: string,
  meta?: SkillWritingQualityMeta,
): readonly SkillWritingQualityIssue[] {
  const text = body.trim();
  const issues: SkillWritingQualityIssue[] = [];
  if (text.length < 40) {
    issues.push({
      code: 'empty_steps',
      message: 'Skill body is too short — include ordered steps with a checkable completion criterion.',
    });
    return issues;
  }

  if (/apply the steps that led to a successful outcome/i.test(text)) {
    issues.push({
      code: 'generic_template',
      message:
        'Skill body is a generic retry template — write the exact commands, files, or decision rule that worked.',
    });
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

  if (!hasActionableSteps(text)) {
    issues.push({
      code: 'no_actionable_steps',
      message:
        'Skill body needs ordered steps and at least one concrete command, path, or decision rule a future agent can follow.',
    });
  }

  const description = meta?.description ?? '';
  const whenToUse = meta?.whenToUse ?? '';
  if ((description.length > 0 || whenToUse.length > 0) && !hasSearchTriggers(description, whenToUse)) {
    issues.push({
      code: 'not_searchable',
      message:
        'description and whenToUse need 3+ distinct English trigger tokens (task, domain, error, or tool) so SearchSkill can find this skill later.',
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

function hasActionableSteps(text: string): boolean {
  if (/(?:^|\n)\s*\d+\.\s+\S/.test(text)) return true;
  if (/`[^`]{3,}`/.test(text)) return true;
  if (
    /\b(?:pnpm|npm|npx|node|git|liora|vitest|pytest|cargo|bash|curl)\b/i.test(text)
  ) {
    return true;
  }
  if (/[/\\][\w.-]+\/[\w.-]+/.test(text)) return true;
  return /\b(?:JobCreate|JobInspect|SearchSkill|RunProjectChecks)\b/.test(text);
}

function hasSearchTriggers(description: string, whenToUse: string): boolean {
  const blob = `${description} ${whenToUse}`.toLowerCase();
  const tokens = blob.match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  return new Set(tokens).size >= 3;
}

export function formatSkillWritingQualityFailure(
  issues: readonly SkillWritingQualityIssue[],
): string {
  return [
    'SkillCreate rejected — writing-for-agents quality gate:',
    ...issues.map((i) => `- ${i.message}`),
  ].join('\n');
}
