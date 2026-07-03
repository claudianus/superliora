/**
 * EnterPlanModeTool — plan-mode entry tool.
 *
 * The LLM calls this tool to enter plan mode directly. Entering plan mode
 * does not require approval in any permission mode.
 */

import type { Agent } from '#/agent';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './enter-plan-mode.md?raw';

// ── Input schema ─────────────────────────────────────────────────────

export const EnterPlanModeInputSchema = z.object({
  ultra: z.boolean().optional().describe('Enter Ultra Plan mode with Seed Spec, AC Tree, and Evaluation Plan support.'),
  initial_context: z
    .string()
    .trim()
    .optional()
    .describe('Optional original task context used to seed Ultra Plan ambiguity scoring.'),
}).strict();
export type EnterPlanModeInput = z.infer<typeof EnterPlanModeInputSchema>;

export class EnterPlanModeTool implements BuiltinTool<EnterPlanModeInput> {
  readonly name = 'EnterPlanMode' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(EnterPlanModeInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: EnterPlanModeInput): ToolExecution {
    return {
      description: args.ultra ? 'Requesting to enter Ultra Plan mode' : 'Requesting to enter plan mode',
      approvalRule: this.name,
      execute: async () => {
        // Guard: already in plan mode
        if (this.agent.planMode.isActive) {
          if (this.agent.planMode.isUltraMode) {
            return {
              isError: true,
              output:
                'Ultra Plan mode is already active. Do not call EnterPlanMode again or pass it a phase argument. Use NextPhase to advance Ultra Plan phases.',
            };
          }
          return {
            isError: true,
            output: 'Plan mode is already active. Use ExitPlanMode when the plan is ready.',
          };
        }

        try {
          await this.agent.planMode.enter(
            undefined,
            false,
            true,
            args.ultra ?? false,
            args.initial_context ?? '',
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to enter plan mode.';
          return { isError: true, output: `Failed to enter plan mode: ${message}` };
        }

        this.agent.telemetry.track('plan_enter_resolved', { outcome: 'auto_approved', ultra: args.ultra ?? false });
        return { output: enteredPlanModeMessage(this.agent.planMode.planFilePath, args.ultra ?? false) };
      },
    };
  }
}

function enteredPlanModeMessage(planPath: string | null, ultra: boolean): string {
  if (ultra) {
    if (planPath === null) {
      return [
        'Ultra Plan mode is now active. Your workflow:',
        '',
        '1. Research — Use read-only search, fetch, and code context to gather current evidence before asking questions.',
        '2. Interview — Use AskUserQuestion to clarify only the blocking choices that remain.',
        '3. Seed Spec — Define the immutable Goal, Constraints, AC Tree, and Ontology.',
        '4. Design — Converge on the best approach; consider trade-offs.',
        '5. Review — Re-read key files to verify understanding.',
        '6. Write Plan — Include WorkGraph, Evaluation Plan, and Execution Plan in the plan file.',
        '7. Exit — Call ExitPlanMode for user approval.',
        '',
        'No plan file path is available in this host yet.',
        'Use Bash only when needed; Bash follows the normal permission mode and rules.',
      ].join('\n');
    }

    return [
      'Ultra Plan mode is now active. Your workflow:',
      '',
      `Plan file: ${planPath}`,
      '',
      '1. Research — Use read-only search, fetch, and code context to gather current evidence before asking questions.',
      '2. Interview — Use AskUserQuestion to clarify only the blocking choices that remain.',
      '3. Seed Spec — Write the immutable Goal, Constraints, AC Tree, and Ontology to the plan file.',
      '4. Design — Converge on the best approach; consider trade-offs.',
      '5. Review — Re-read key files to verify understanding.',
      '6. Write Plan — Include WorkGraph, Evaluation Plan, and Execution Plan in the plan file.',
      '7. Exit — Call ExitPlanMode for user approval.',
      '',
      'Do NOT edit files other than the plan file while Ultra Plan mode is active.',
      'Use Bash only when needed; Bash follows the normal permission mode and rules.',
    ].join('\n');
  }

  if (planPath === null) {
    return [
      'Plan mode is now active. Your workflow:',
      '',
      '1. Use read-only tools (Read, Grep, Glob) to investigate the codebase. Use Bash only when needed.',
      '2. Design a concrete, step-by-step plan.',
      '3. Wait for the host to provide a plan file path before calling ExitPlanMode.',
      '',
      'Do NOT use Write or Edit while plan mode is active in this host; no plan file path is available.',
      'Use Bash only when needed; Bash follows the normal permission mode and rules.',
    ].join('\n');
  }

  return [
    'Plan mode is now active. Your workflow:',
    '',
    `Plan file: ${planPath}`,
    '',
    '1. Use read-only tools (Read, Grep, Glob) to investigate the codebase. Use Bash only when needed.',
    '2. Design a concrete, step-by-step plan.',
    '3. Write the plan to the plan file with Write or Edit.',
    '4. When the plan is ready, call ExitPlanMode for user approval.',
    '',
    'Do NOT edit files other than the plan file while plan mode is active.',
    'Use Bash only when needed; Bash follows the normal permission mode and rules.',
  ].join('\n');
}
