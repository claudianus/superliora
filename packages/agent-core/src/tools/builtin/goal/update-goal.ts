/**
 * UpdateGoalTool — the model's single lever over the goal lifecycle. It updates
 * the goal's status directly; the turn driver reads the status at each turn
 * boundary and stops (`complete` / `blocked` / `paused`) or keeps going
 * (`active`).
 *
 * The argument is intentionally just a status enum — no reason or evidence. The
 * model explains itself in its own reply; the status is the machine-readable
 * signal. The tool is only offered to the model while a goal exists (see the
 * `loopTools` filter in the tool manager).
 */

import type { Agent } from '#/agent/index';
import { z } from 'zod';

import {
  GOAL_BLOCKED_REMINDER_NAME,
  GOAL_COMPLETION_REMINDER_NAME,
} from '../../../agent/turn/reminder-names';
import {
  evaluateGoalCompletionSoftAdvisory,
  formatGoalCompletionSoftAdvisory,
} from '../../../agent/goal/goal-completion-soft-advisory';
import {
  buildGoalBlockedReasonPrompt,
  buildGoalCompletionSummaryPrompt,
} from './outcome-prompts';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './update-goal.md?raw';

export const UpdateGoalToolInputSchema = z
  .object({
    status: z
      .enum(['active', 'complete', 'paused', 'blocked'])
      .describe('The lifecycle status to set for the current goal.'),
  })
  .strict();

export type UpdateGoalToolInput = z.infer<typeof UpdateGoalToolInputSchema>;

export class UpdateGoalTool implements BuiltinTool<UpdateGoalToolInput> {
  readonly name = 'UpdateGoal' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(UpdateGoalToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: UpdateGoalToolInput): ToolExecution {
    const goal = this.agent.goal;

    return {
      description: `Setting goal status: ${args.status}`,
      stopBatchAfterThis: args.status !== 'active',
      approvalRule: this.name,
      execute: async () => {
        if (args.status === 'active') {
          await goal.resumeGoal({}, 'model');
          return { output: 'Goal resumed.' };
        }
        if (args.status === 'complete') {
          const completed = await goal.markComplete({}, 'model');
          // `complete` is transient: markComplete announces then clears the
          // record. Store the summary request as a system reminder, so the next
          // provider request ends with a user message after the UpdateGoal tool
          // result. Anthropic-compatible providers reject trailing assistant
          // messages as unsupported prefill.
          if (completed !== null) {
            this.agent.context.appendSystemReminder(buildGoalCompletionSummaryPrompt(completed), {
              kind: 'system_trigger',
              name: GOAL_COMPLETION_REMINDER_NAME,
            });
            const advisory = evaluateGoalCompletionSoftAdvisory({
              ultraworkRun: this.agent.ultrawork?.getRun() ?? null,
              completionCriterion: completed.completionCriterion,
              recentVerificationFailures: this.agent.verificationSensorLedger.failures,
            });
            const output =
              advisory === null
                ? 'Goal marked complete.'
                : ['Goal marked complete.', '', formatGoalCompletionSoftAdvisory(advisory)].join(
                    '\n',
                  );
            return { output, stopTurn: true };
          }
          // Ultrawork completion audit rejected a false complete — keep the
          // loop running (do not stopTurn) so the model continues work.
          const rejection = goal.getLastCompletionRejection();
          if (rejection !== undefined) {
            return {
              output: [
                'Goal completion rejected (false-complete guard).',
                `code: ${rejection.code}`,
                ...rejection.reasons.map((r) => `- ${r}`),
                'Next:',
                ...rejection.nextActions.map((a) => `- ${a}`),
                'Keep implementing and verifying; do not claim done without WorkGraph evidence.',
              ].join('\n'),
              isError: true,
            };
          }
          return {
            output: 'Goal could not be marked complete (missing or inactive).',
            isError: true,
          };
        }
        if (args.status === 'blocked') {
          const blocked = await goal.markBlocked({}, 'model');
          if (blocked !== null) {
            this.agent.context.appendSystemReminder(buildGoalBlockedReasonPrompt(blocked), {
              kind: 'system_trigger',
              name: GOAL_BLOCKED_REMINDER_NAME,
            });
          }
          return { output: 'Goal marked blocked.', stopTurn: true };
        }
        await goal.pauseGoal({}, 'model');
        return { output: 'Goal paused.', stopTurn: true };
      },
    };
  }
}
