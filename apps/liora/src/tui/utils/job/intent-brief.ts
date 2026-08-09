/**
 * Structured Intent Composer brief — pure helpers (no TUI state).
 */

export type ConductorProjectMode = 'balanced' | 'greenfield' | 'hotfix' | 'review';

export const CONDUCTOR_PROJECT_MODE_POOL: Readonly<Record<ConductorProjectMode, number>> = {
  balanced: 6,
  greenfield: 4,
  hotfix: 2,
  review: 3,
};

export const CONDUCTOR_PROJECT_MODES: readonly ConductorProjectMode[] = [
  'balanced',
  'greenfield',
  'hotfix',
  'review',
];

export interface IntentBriefFields {
  readonly successCriteria: readonly string[];
  readonly mustNotTouch: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly contextPaths: readonly string[];
}

export function cycleConductorProjectMode(
  current: ConductorProjectMode | undefined,
): ConductorProjectMode {
  const idx = CONDUCTOR_PROJECT_MODES.indexOf(current ?? 'balanced');
  return CONDUCTOR_PROJECT_MODES[(idx + 1) % CONDUCTOR_PROJECT_MODES.length]!;
}

export function linesFromText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function intentBriefHasFields(fields: IntentBriefFields): boolean {
  return (
    fields.successCriteria.length > 0 ||
    fields.mustNotTouch.length > 0 ||
    fields.verificationCommands.length > 0 ||
    fields.contextPaths.length > 0
  );
}

function bulletBlock(label: string, items: readonly string[]): string | undefined {
  if (items.length === 0) return undefined;
  return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

/** Prefix block for Conductor / greenfield prompts. */
export function buildStructuredBriefPrefix(fields: IntentBriefFields): string {
  const parts = [
    bulletBlock('Success criteria', fields.successCriteria),
    bulletBlock('Must not touch', fields.mustNotTouch),
    bulletBlock('Verification commands', fields.verificationCommands),
    bulletBlock('Context paths', fields.contextPaths),
  ].filter((part): part is string => part !== undefined);
  if (parts.length === 0) return '';
  return `[Conductor brief]\n${parts.join('\n\n')}`;
}

/** Attach brief prefix above free-text prompt. */
export function attachStructuredBrief(prompt: string, fields: IntentBriefFields): string {
  const prefix = buildStructuredBriefPrefix(fields);
  if (prefix.length === 0) return prompt;
  const body = prompt.trim();
  return body.length === 0 ? prefix : `${prefix}\n\n---\n${body}`;
}

/** Default expand state for Intent Composer from project mode. */
export function intentComposerExpandedByDefault(mode: ConductorProjectMode): boolean {
  return mode === 'greenfield';
}

/** Greenfield staff needs at least one success criterion. */
export function intentBriefIncompleteForGreenfield(fields: IntentBriefFields): boolean {
  return fields.successCriteria.length === 0;
}

/**
 * AskUserQuestion-friendly prompt when greenfield brief slots are empty.
 * Conductor / Intent Composer can inject this before staffing.
 */
export function askUserQuestionTemplateForIncompleteBrief(
  fields: IntentBriefFields,
): string {
  const missing: string[] = [];
  if (fields.successCriteria.length === 0) {
    missing.push('Success criteria — what does done look like?');
  }
  if (fields.mustNotTouch.length === 0) {
    missing.push('Must not touch — paths or areas to leave alone (or say none)');
  }
  if (fields.verificationCommands.length === 0) {
    missing.push('Verification commands — how should workers prove the work?');
  }
  if (fields.contextPaths.length === 0) {
    missing.push('Context paths — files/dirs workers should read first (or say none)');
  }
  if (missing.length === 0) return '';
  return [
    'Greenfield brief is incomplete — answer each item before Conductor staffs Jobs:',
    ...missing.map((line, i) => `${String(i + 1)}. ${line}`),
  ].join('\n');
}

/** Slot placeholders / starter lines by mode (empty = no prefill). */
export function intentComposerDefaultsForMode(mode: ConductorProjectMode): IntentBriefFields {
  if (mode === 'hotfix') {
    return {
      successCriteria: ['Regression fixed; existing tests still green'],
      mustNotTouch: [],
      verificationCommands: [],
      contextPaths: [],
    };
  }
  if (mode === 'greenfield') {
    return {
      successCriteria: [],
      mustNotTouch: [],
      verificationCommands: [],
      contextPaths: [],
    };
  }
  if (mode === 'review') {
    return {
      successCriteria: ['Independent review verdict = pass'],
      mustNotTouch: [],
      verificationCommands: [],
      contextPaths: [],
    };
  }
  return {
    successCriteria: [],
    mustNotTouch: [],
    verificationCommands: [],
    contextPaths: [],
  };
}
