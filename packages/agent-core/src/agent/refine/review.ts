/**
 * Auto-refine review gate (prime parity): before an automatic refine run
 * spends a full planning call, a cheap logic-only model judges whether the
 * recent trajectory holds a durable, reusable lesson worth persisting.
 * Manual /refine skips this gate — the operator already decided.
 */

import { z } from 'zod';

import type { Agent } from '..';
import { createCompactionProvider } from '../compaction/full/full-provider';
import { sliceJsonObject } from './plan';
import { serializeTrajectoryForRefine } from './serialize';
import {
  renderHarnessPromptSection,
  renderHarnessRosterSection,
  type HarnessState,
} from './state';

/** Smaller slice than the planner's: the gate only needs the gist. */
export const REVIEW_TRAJECTORY_MAX_CHARS = 40_000;

const AutoRefineReviewSchema = z
  .object({
    shouldRefine: z.boolean(),
    rationale: z.string(),
    instructions: z.string().optional(),
  })
  .strict();

export type AutoRefineReview = z.infer<typeof AutoRefineReviewSchema>;

export class RefineReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefineReviewError';
  }
}

const REVIEW_SYSTEM_PROMPT = [
  'You are the auto-refine review gate for a coding agent\'s continual harness.',
  'An automatic refinement run is being considered. Refinement rewrites parts of the agent\'s own harness (prompt notes, memory, skills, subagent specs) from the recent trajectory. It costs a planning pass, so it should run only when the trajectory contains a durable, reusable lesson.',
  '',
  'Answer yes only when the trajectory shows at least one of:',
  '- a repeated failure or correction the agent should not have to rediscover,',
  '- a user correction or preference worth persisting,',
  '- a reusable procedure or delegation pattern that worked and recurs,',
  '- a harness gap that clearly caused wasted work.',
  '',
  'Ordinary progress, one-off tasks, and lessons already present in the harness state do not justify a run.',
  '',
  'Return JSON only, no prose:',
  '{"shouldRefine": boolean, "rationale": "one sentence", "instructions": "when yes: one sentence telling the planner what to focus on"}',
].join('\n');

export async function reviewAutoRefine(
  agent: Agent,
  input: {
    readonly state: HarnessState;
    readonly signal?: AbortSignal;
  },
): Promise<AutoRefineReview> {
  const history = agent.context.history;
  if (history.length === 0) {
    throw new RefineReviewError('Nothing to review: the session has no messages yet.');
  }
  const provider = createCompactionProvider(
    { agent, compactionModelAlias: undefined },
    agent.context.tokenCount,
  );
  const result = await agent.generate(
    provider,
    REVIEW_SYSTEM_PROMPT,
    [],
    [
      {
        role: 'user',
        content: [{ type: 'text', text: buildReviewUserPrompt(agent, input.state) }],
        toolCalls: [],
      },
    ],
    undefined,
    input.signal !== undefined ? { signal: input.signal } : undefined,
  );
  const text = result.message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  return parseAutoRefineReview(text);
}

function buildReviewUserPrompt(agent: Agent, state: HarnessState): string {
  const harnessSections = [
    renderHarnessPromptSection(state),
    renderHarnessRosterSection(state),
  ].filter((section): section is string => section !== undefined);
  const recentRefinements = state.refinements.slice(-10).map((event) => {
    return `- ${event.status} ${event.kind} ${event.targetId}: ${event.summary}`;
  });
  return [
    'Current harness state:',
    harnessSections.length > 0 ? harnessSections.join('\n\n') : '(empty)',
    '',
    'Recent refinements:',
    recentRefinements.length > 0 ? recentRefinements.join('\n') : '(none)',
    '',
    'Serialized trajectory:',
    '```text',
    serializeTrajectoryForRefine(agent.context.history, REVIEW_TRAJECTORY_MAX_CHARS),
    '```',
  ].join('\n');
}

export function parseAutoRefineReview(text: string): AutoRefineReview {
  const parsed = sliceJsonObject(
    text,
    (message) => new RefineReviewError(`Review gate returned ${message}`),
  );
  const validated = AutoRefineReviewSchema.safeParse(parsed);
  if (!validated.success) {
    throw new RefineReviewError(
      `Review gate JSON failed validation: ${validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return validated.data;
}
