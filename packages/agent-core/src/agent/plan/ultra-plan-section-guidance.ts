/** Ultra Plan required Seed sections and interview section guidance. */

export const ULTRA_PLAN_REQUIRED_SECTIONS = [
  'goal',
  'actors',
  'inputs',
  'outputs',
  'constraints',
  'non_goals',
  'acceptance_criteria',
  'verification_plan',
  'failure_modes',
  'runtime_context',
] as const;

export type UltraPlanRequiredSection = typeof ULTRA_PLAN_REQUIRED_SECTIONS[number];

export const ULTRA_PLAN_SECTION_GUIDANCE: Record<
  UltraPlanRequiredSection,
  { readonly label: string; readonly askHint: string }
> = {
  goal: {
    label: 'Goal / UltraGoal',
    askHint: 'State the single deliverable or outcome in one concrete sentence.',
  },
  actors: {
    label: 'Actors',
    askHint: 'Who is involved (user, agent, reviewer, end-user)?',
  },
  inputs: {
    label: 'Inputs',
    askHint: 'What artifacts, files, APIs, or context does the work start from?',
  },
  outputs: {
    label: 'Outputs',
    askHint: 'What concrete deliverables will exist when done (files, docs, UI, decisions)?',
  },
  constraints: {
    label: 'Constraints',
    askHint: 'What limits apply (time, tech stack, budget, brand, must-not-change rules)?',
  },
  non_goals: {
    label: 'Non-goals',
    askHint: 'What is explicitly out of scope?',
  },
  acceptance_criteria: {
    label: 'Acceptance Criteria',
    askHint: 'What checks must pass for the work to be accepted?',
  },
  verification_plan: {
    label: 'Verification Plan',
    askHint: 'How will you verify success (tests, review, demo, metrics)?',
  },
  failure_modes: {
    label: 'Failure Modes',
    askHint: 'What could go wrong or what regressions must be avoided?',
  },
  runtime_context: {
    label: 'Runtime Context',
    askHint: 'Where does this run (repo, stack, environment, audience)?',
  },
};


/** Soft cap on interview rounds — surfaces a warning in the readiness guide but
 *  does not bypass the Design gate. */
export const MAX_INTERVIEW_ROUNDS = 8;

