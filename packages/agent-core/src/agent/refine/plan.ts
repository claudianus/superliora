/**
 * Refine planner: one logic-only LLM call over the serialized trajectory
 * producing a validated edit proposal. Provider construction reuses the
 * compaction summarizer path (cheap model alias, thinking off) — a refine
 * plan is the same class of cost-sensitive, no-tools generation.
 */

import { z } from 'zod';

import type { Agent } from '..';
import { createCompactionProvider } from '../compaction/full/full-provider';
import { buildRefineSystemPrompt, buildRefineUserPrompt } from './prompts';
import { serializeTrajectoryForRefine } from './serialize';
import type { HarnessScope, HarnessState } from './state';

export const MAX_REFINE_EDITS_PER_RUN = 8;

const HarnessEditSchema = z
  .object({
    kind: z.enum(['prompt', 'memory', 'skill', 'subagent']),
    operation: z.enum(['create', 'update', 'delete']),
    targetId: z.string().min(1).optional(),
    expectedVersion: z.number().int().positive().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    path: z.string().optional(),
    subject: z.string().optional(),
    tags: z.array(z.string()).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    whenToUse: z.string().optional(),
    body: z.string().optional(),
    evidence: z.string().min(1),
  })
  .strict();

const RefinePlanSchema = z
  .object({
    summary: z.string(),
    edits: z.array(HarnessEditSchema).max(MAX_REFINE_EDITS_PER_RUN),
  })
  .strict();

export type HarnessEdit = z.infer<typeof HarnessEditSchema>;
export type RefinePlan = z.infer<typeof RefinePlanSchema>;

export class RefinePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefinePlanError';
  }
}

export async function planRefinement(
  agent: Agent,
  input: {
    readonly scope: HarnessScope;
    readonly state: HarnessState;
    readonly instructions?: string;
    readonly signal?: AbortSignal;
  },
): Promise<RefinePlan> {
  const history = agent.context.history;
  if (history.length === 0) {
    throw new RefinePlanError('Nothing to refine: the session has no messages yet.');
  }
  const provider = createCompactionProvider(
    { agent, compactionModelAlias: undefined },
    agent.context.tokenCount,
  );
  const result = await agent.generate(
    provider,
    buildRefineSystemPrompt(input.scope),
    [],
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildRefineUserPrompt({
              scope: input.scope,
              state: input.state,
              instructions: input.instructions,
              serializedTrajectory: serializeTrajectoryForRefine(history),
            }),
          },
        ],
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
  return parseRefinePlan(text);
}

/** Slice the outermost JSON object out of possibly prose-wrapped text. */
export function sliceJsonObject(text: string, onError: (message: string) => Error): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw onError('no JSON object in model output');
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch (error) {
    throw onError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseRefinePlan(text: string): RefinePlan {
  const parsed = sliceJsonObject(
    text,
    (message) => new RefinePlanError(`Refine planner returned ${message}`),
  );
  const validated = RefinePlanSchema.safeParse(parsed);
  if (!validated.success) {
    throw new RefinePlanError(
      `Refine planner JSON failed validation: ${validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return validated.data;
}
