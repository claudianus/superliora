/**
 * GetGoalTool — returns the current goal snapshot (objective, status, budgets,
 * and usage counters) so the model can decide whether to continue, report
 * completion via UpdateGoal, report a blocker, or respect a pause.
 *
 * On Conductor this reads the session Goal Desk binding, not the empty main
 * GoalMode — otherwise `/goal` (or CreateGoal → facade) looks like `{ goal: null }`.
 */

import type { Agent } from '#/agent/index';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { shouldDelegateGoalToDesk } from './goal-desk';
import { conductorGetGoal } from './goal-desk-facade';
import DESCRIPTION from './get-goal.md?raw';
import { goalResultForModel } from './serialize';

export const GetGoalToolInputSchema = z.object({}).strict();
export type GetGoalToolInput = z.infer<typeof GetGoalToolInputSchema>;

export class GetGoalTool implements BuiltinTool<GetGoalToolInput> {
  readonly name = 'GetGoal' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GetGoalToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(_args: GetGoalToolInput): ToolExecution {
    const store = this.agent.goal;
    return {
      accesses: ToolAccesses.none(),
      description: 'Reading the current goal',
      approvalRule: this.name,
      execute: async () => {
        const result = shouldDelegateGoalToDesk(this.agent)
          ? conductorGetGoal(this.agent)
          : store.getGoal();
        return { output: JSON.stringify(goalResultForModel(result), null, 2) };
      },
    };
  }
}
