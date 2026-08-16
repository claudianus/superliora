/**
 * CreateGoalTool — lets the main agent start an explicit goal on the user's
 * behalf. Non-Conductor profiles write GoalMode (Ralph loop). Conductor
 * offloads to Goal Desk + goal-driver via the same Session Goal API as `/goal`.
 */

import type { Agent } from '#/agent/index';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import type { ToolInputDisplay } from '../../display';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './create-goal.md?raw';
import { shouldDelegateGoalToDesk } from './goal-desk';
import { conductorCreateGoal } from './goal-desk-facade';
import { goalForModel } from './serialize';

export const CreateGoalToolInputSchema = z
  .object({
    objective: z.string().min(1).describe('The objective to pursue. Must have a verifiable end state.'),
    completionCriterion: z
      .string()
      .optional()
      .describe('How to verify the goal is complete. Include when the user provides one.'),
    gateCommand: z
      .string()
      .optional()
      .describe(
        'Shell command that must exit 0 before the goal may complete (e.g. "npm run check"). Every completion attempt runs it; a failure returns the output tail and keeps the goal active. Include when the user names a verification command.',
      ),
    replace: z
      .boolean()
      .optional()
      .describe('Replace an existing active, paused, or blocked goal instead of failing.'),
  })
  .strict();

export type CreateGoalToolInput = z.infer<typeof CreateGoalToolInputSchema>;

export class CreateGoalTool implements BuiltinTool<CreateGoalToolInput> {
  readonly name = 'CreateGoal' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(CreateGoalToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: CreateGoalToolInput): ToolExecution {
    const goal = this.agent.goal;

    return {
      accesses: ToolAccesses.all(),
      description: 'Creating a goal',
      display: this.resolveGoalStartDisplay(args),
      approvalRule: this.name,
      execute: async () => {
        const snapshot = shouldDelegateGoalToDesk(this.agent)
          ? await conductorCreateGoal(this.agent, {
              objective: args.objective,
              completionCriterion: args.completionCriterion,
              gateCommand: args.gateCommand,
              replace: args.replace,
            })
          : await goal.createGoal(
              {
                objective: args.objective,
                completionCriterion: args.completionCriterion,
                gateCommand: args.gateCommand,
                replace: args.replace,
              },
              'model',
            );
        return { output: JSON.stringify({ goal: goalForModel(snapshot) }, null, 2) };
      },
    };
  }

  /**
   * Starting a goal switches the agent into autonomous, multi-turn work, so its
   * approval reuses the same choice the `/goal` command offers: pick the
   * permission mode to run under, or decline. `auto` mode auto-approves the goal
   * upstream and never reaches this prompt, so the menu only covers manual/yolo.
   */
  private resolveGoalStartDisplay(args: CreateGoalToolInput): ToolInputDisplay | undefined {
    const mode = this.agent.permission.mode;
    if (mode === 'auto') return undefined;
    return {
      kind: 'goal_start',
      objective: args.objective,
      completionCriterion: args.completionCriterion,
      mode,
    };
  }
}
