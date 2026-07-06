export interface ExpertTaskProfile {
  readonly technical: boolean;
  readonly preferredDivisions: readonly string[];
  readonly excludedDivisions: readonly string[];
}

const TECHNICAL_TASK_PATTERN =
  /\b(?:typescript|javascript|python|rust|go|java|code|coding|engineer|engineering|tui|terminal|cli|react|vue|component|api|bug|fix|implement|refactor|monorepo|vitest|jest|test suite|renderer|dashboard|layout|superliora|liora|agent-core|node-sdk|packages\/)\b/i;

const NON_TECHNICAL_DOMAIN_PATTERN =
  /\b(?:sales|marketing|seo|paid media|grant|fundraising|coaching|pipeline|crm|revenue ops|brand campaign|social media growth)\b/i;

export function inferExpertTaskProfile(taskDescription: string): ExpertTaskProfile {
  const text = taskDescription.trim();
  const technical = TECHNICAL_TASK_PATTERN.test(text) && !NON_TECHNICAL_DOMAIN_PATTERN.test(text);
  if (!technical) {
    return {
      technical: false,
      preferredDivisions: [],
      excludedDivisions: [],
    };
  }
  return {
    technical: true,
    preferredDivisions: ['engineering', 'design', 'testing', 'product', 'security', 'project-management'],
    excludedDivisions: ['sales', 'marketing', 'paid-media', 'finance', 'support'],
  };
}
