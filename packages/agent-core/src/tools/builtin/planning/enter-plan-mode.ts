/**
 * EnterPlanModeTool — plan-mode entry tool.
 *
 * The LLM calls this tool to enter plan mode directly. Entering plan mode
 * does not require approval in any permission mode.
 *
 * On the Conductor lane, Plan Desk intercepts: create a mission Job and ACK
 * instead of activating the structured-plan engine inline (tool waist +
 * ConductorDirectWorkGuard cannot run research/write phases).
 */

import type { Agent } from '#/agent/index';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './enter-plan-mode.md?raw';
import { delegateConductorPlanDesk, shouldDelegateToPlanDesk } from './plan-desk';
import { resolvePlanModeKind } from './resolve-plan-mode-kind';

// ── Input schema ─────────────────────────────────────────────────────

export const EnterPlanModeInputSchema = z.object({
  ultra: z
    .boolean()
    .optional()
    .describe(
      'true = Ultra/structured (Socratic interview → Seed Spec/AC Tree; for vague/greenfield/high-stakes). false = Regular free-form plan (scoped, already-clear work). Omit to auto-route from initial_context.',
    ),
  initial_context: z
    .string()
    .trim()
    .optional()
    .describe(
      'User task text for routing + Ultra ambiguity scoring / Plan Job brief. Always pass the original ask when available.',
    ),
}).strict();
export type EnterPlanModeInput = z.infer<typeof EnterPlanModeInputSchema>;

export class EnterPlanModeTool implements BuiltinTool<EnterPlanModeInput> {
  readonly name = 'EnterPlanMode' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(EnterPlanModeInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: EnterPlanModeInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: args.ultra
        ? 'Delegating structured plan to a Job (or entering plan mode)'
        : 'Requesting to enter plan mode',
      approvalRule: this.name,
      execute: async () => {
        const activationSource =
          this.agent.ultrawork.getRun()?.status === 'running' ? ('ultrawork' as const) : ('standalone' as const);
        const routed = resolvePlanModeKind({
          ultra: args.ultra,
          initialContext: args.initial_context,
          source: activationSource,
        });
        const useUltra = routed.kind === 'ultra';

        // Plan Desk: Conductor never runs the phase engine on its own lane.
        if (shouldDelegateToPlanDesk(this.agent, args.initial_context)) {
          if (this.agent.planMode.isActive) {
            this.agent.planMode.cancel();
          }
          const delegated = await delegateConductorPlanDesk(this.agent, {
            ultra: useUltra,
            initialContext: args.initial_context,
            source: activationSource,
          });
          this.agent.telemetry.track('plan_enter_resolved', {
            outcome: 'plan_desk_delegated',
            ultra: useUltra,
            route_reason: routed.reason,
            job_id: delegated.job.id,
          });
          return {
            output: `${delegated.output}\n\nRoute: ${routed.kind} (${routed.reason})`,
          };
        }

        // Guard: already in plan mode
        if (this.agent.planMode.isActive) {
          if (this.agent.planMode.isUltraMode) {
            return {
              isError: true,
              output:
                'Structured plan mode is already active. Do not call EnterPlanMode again or pass it a phase argument. Use NextPhase to advance phases.',
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
            useUltra,
            args.initial_context ?? '',
            activationSource,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to enter plan mode.';
          return { isError: true, output: `Failed to enter plan mode: ${message}` };
        }

        this.agent.telemetry.track('plan_enter_resolved', {
          outcome: 'auto_approved',
          ultra: useUltra,
          route_reason: routed.reason,
        });
        return {
          output: `${enteredPlanModeMessage(this.agent.planMode.planFilePath, useUltra)}\n\nRoute: ${routed.kind} (${routed.reason})`,
        };
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
        '2. Interview — Expert interview: teach insights, elevate the goal, and present evidence-backed upgrade choices (not just gap-filling).',
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
      '2. Interview — Expert interview: teach insights, elevate the goal, and present evidence-backed upgrade choices (not just gap-filling).',
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
