/**
 * CreateUltraGoalTool — structured loop engineering tool that the LLM can
 * invoke (with user approval) to activate a verification-driven goal.
 *
 * Two modes:
 * - closed: Evaluator-Optimizer loop with acceptance criteria as the verifier
 * - open: Self-improvement loop with quality floor + circuit breaker
 */

import type { Agent } from '#/agent';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import type { ToolInputDisplay } from '../../display';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './create-ultra-goal.md?raw';
import { goalForModel } from './serialize';

export const CreateUltraGoalToolInputSchema = z
  .object({
    objective: z.string().min(1).describe('The objective to pursue.'),
    mode: z
      .enum(['closed', 'open'])
      .optional()
      .describe('Loop mode: "closed" = verify against acceptance criteria until all pass; "open" = continuous self-improvement with quality floor. Defaults to "closed".'),
    acceptanceCriteria: z
      .array(z.string())
      .optional()
      .describe('For closed mode: 2-5 objectively testable criteria. If omitted, define them as the first action after approval.'),
    qualityFloor: z
      .string()
      .optional()
      .describe('For open mode: minimum quality standard that must never degrade (e.g. "all tests pass, linter 0 errors").'),
    replace: z
      .boolean()
      .optional()
      .describe('Replace an existing active goal instead of failing.'),
  })
  .strict();

export type CreateUltraGoalToolInput = z.infer<typeof CreateUltraGoalToolInputSchema>;

export class CreateUltraGoalTool implements BuiltinTool<CreateUltraGoalToolInput> {
  readonly name = 'CreateUltraGoal' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(CreateUltraGoalToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: CreateUltraGoalToolInput): ToolExecution {
    const goal = this.agent.goal;
    const mode = args.mode ?? 'closed';

    return {
      description: `Creating UltraGoal (${mode} loop)`,
      display: this.resolveDisplay(args, mode),
      approvalRule: this.name,
      execute: async () => {
        const completionCriterion =
          mode === 'closed'
            ? args.acceptanceCriteria?.join('; ') ?? 'All acceptance criteria pass with evidence'
            : args.qualityFloor ?? 'Quality floor maintained';

        const snapshot = await goal.createGoal(
          {
            objective: args.objective,
            completionCriterion,
            replace: args.replace,
            source: 'standalone',
          },
          'model',
        );

        const protocol = mode === 'closed'
          ? this.buildClosedProtocol(args)
          : this.buildOpenProtocol(args);

        return {
          output: JSON.stringify(
            {
              goal: goalForModel(snapshot),
              loopProtocol: protocol,
            },
            null,
            2,
          ),
        };
      },
    };
  }

  private buildClosedProtocol(args: CreateUltraGoalToolInput): string {
    const criteria = args.acceptanceCriteria;
    const lines = [
      'LOOP PROTOCOL: Evaluator-Optimizer (closed loop)',
      '1. DEFINE VERIFIER: ' +
        (criteria
          ? `Acceptance criteria: ${criteria.join('; ')}. Confirm with user.`
          : 'Define 2-5 objectively testable acceptance criteria. Present for user confirmation.'),
      '2. RESEARCH: Investigate codebase before implementing.',
      '3. EXECUTE: Implement incrementally.',
      '4. VERIFY: Check EVERY criterion with real evidence after each change.',
      '5. LOOP: If any criterion fails → return to step 3.',
      '6. DONE: Mark complete ONLY when ALL criteria have passing evidence.',
    ];
    return lines.join('\n');
  }

  private buildOpenProtocol(args: CreateUltraGoalToolInput): string {
    const floor = args.qualityFloor ?? 'Define quality floor first';
    const lines = [
      'LOOP PROTOCOL: Open Loop with Circuit Breaker (self-improvement)',
      `QUALITY FLOOR: ${floor}`,
      '1. OBSERVE: Identify highest-impact improvement opportunity.',
      '2. IMPROVE: Make ONE focused, verifiable improvement.',
      '3. VERIFY FLOOR: Run quality floor checks. If violated → revert.',
      '4. REPORT: State what improved + next opportunity.',
      '5. LOOP: Continue. Do NOT ask permission between cycles.',
      'CIRCUIT BREAKER: 3 cycles with no improvement → pause + report stagnation.',
      'This loop runs until the user cancels.',
    ];
    return lines.join('\n');
  }

  private resolveDisplay(args: CreateUltraGoalToolInput, mode: string): ToolInputDisplay | undefined {
    const permMode = this.agent.permission.mode;
    if (permMode === 'auto') return undefined;
    return {
      kind: 'goal_start',
      objective: args.objective,
      completionCriterion:
        mode === 'closed'
          ? args.acceptanceCriteria?.join('; ')
          : args.qualityFloor,
      mode: permMode,
    };
  }
}
