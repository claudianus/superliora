/**
 * NextPhaseTool — Ultra Plan Mode phase transition tool.
 *
 * The LLM calls this tool to advance to the next phase in the ultra plan
 * workflow: research → interview → design → review → write → exit.
 */

import type { Agent } from '#/agent';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { MAX_INTERVIEW_ROUNDS } from '#/agent/plan/ultra-plan-mode';

export const NextPhaseInputSchema = z.object({
  phase: z.enum(['interview', 'design', 'review', 'write', 'exit']).describe(
    'The target phase to advance to. Must be the next logical phase in the workflow.',
  ),
  advance_with_defaults: z
    .boolean()
    .optional()
    .describe(
      'Only valid for interview→design when the round cap is reached. When true, remaining seed gaps are filled with conservative defaults and the interview advances. The user must have explicitly agreed via AskUserQuestion.',
    ),
}).strict();

export type NextPhaseInput = z.infer<typeof NextPhaseInputSchema>;

export class NextPhaseTool implements BuiltinTool<NextPhaseInput> {
  readonly name = 'NextPhase' as const;
  readonly description = `Advance to the next phase in Ultra Plan Mode workflow. Call when the current phase is complete.

- research → interview: after a compact evidence pack for upcoming questions
- interview → design: only when readiness is READY (ambiguity <= 0.2, clarity floors pass, no open_gaps, verifiable_goal=true). If blocked, read the blocker and AskUserQuestion on the listed NEXT TURN focus — do not Write the plan file or repeat resolved questions.
- design → review → write → exit: advance one phase at a time

This is the Ultra Plan phase-transition tool. Do not use EnterPlanMode to advance phases. Forward only, never backward.`;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(NextPhaseInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: NextPhaseInput): ToolExecution {
    return {
      description: `Advancing to ${args.phase} phase`,
      approvalRule: this.name,
      execute: async () => this.execution(args),
    };
  }

  private async execution(args: NextPhaseInput): Promise<ExecutableToolResult> {
    if (!this.agent.planMode.isActive) {
      return {
        isError: true,
        output: 'NextPhase can only be called while plan mode is active.',
      };
    }

    if (!this.agent.planMode.isUltraMode) {
      return {
        isError: true,
        output: 'NextPhase is only available in Ultra Plan mode.',
      };
    }

    const currentPhase = this.agent.planMode.phase;
    const targetPhase = args.phase;

    // Validate phase transition
    const validTransitions: Record<string, string[]> = {
      research: ['interview'],
      interview: ['design'],
      design: ['review'],
      review: ['write'],
      write: ['exit'],
      exit: [],
    };

    if (!validTransitions[currentPhase]?.includes(targetPhase)) {
      return {
        isError: true,
        output: `Invalid phase transition: cannot go from ${currentPhase} to ${targetPhase}. Valid transitions from ${currentPhase}: ${validTransitions[currentPhase]?.join(', ') ?? 'none'}.`,
      };
    }

    if (currentPhase === 'interview' && targetPhase === 'design') {
      const readiness = await this.agent.planMode.ultraEngine.interviewReadiness({ rescore: true });
      if (!readiness.ready) {
        const roundCount = this.agent.planMode.ultraEngine.interviewState.rounds.length;
        const wantsSafeDefault = args.advance_with_defaults === true && roundCount >= MAX_INTERVIEW_ROUNDS;
        if (!wantsSafeDefault) {
          return {
            isError: true,
            output: await this.agent.planMode.ultraEngine.readinessBlockerMessage(),
          };
        }
        // Safe-default advance: round cap reached and user explicitly agreed.
        // Fall through to seed generation — the auto-generated Seed will fill
        // remaining gaps with conservative assumptions.
      }
      if (this.agent.planMode.ultraEngine.seedSpec === null) {
        const seed = await this.agent.planMode.ultraEngine.autoGenerateSeedSpecFromInterview(
          'UltraGoal',
          undefined,
          (delta) => {
            this.agent.emitEvent({
              type: 'thinking.delta',
              turnId: this.agent.turn.currentTurnId() ?? 0,
              delta,
            });
          },
        );
        this.agent.planMode.ultraEngine.setSeedSpec(seed);
      }
    }

    this.agent.planMode.setPhase(targetPhase);
    this.agent.telemetry.track('ultra_plan_phase_transition', { from: currentPhase, to: targetPhase });

    return {
      output: `Advanced from ${currentPhase} phase to ${targetPhase} phase.\n\n${this.phaseInstructions(targetPhase)}`,
    };
  }

  private phaseInstructions(phase: string): string {
    const instructions: Record<string, string> = {
      interview:
        "Interview Phase: Act as an expert leader — teach brief insights, surface unknown-unknowns, Baseline + Upgrade choices with read-only research. PATH 1/3 → RecordInterviewFinding; PATH 2 → AskUserQuestion. After 3 consecutive non-user findings, must AskUserQuestion. When ambiguity <= 0.2, clarity floors pass, UltraGoal is verifiable, and Seed gaps are closed, call NextPhase({ phase: 'design' }).",
      design:
        "Design Phase: Read-only tools + TodoList progress tracking (Context7Resolve/Docs, WebSearch/FetchURL, Liora*, SearchSkill/Skill/SearchExpert, Bash read-only). Explore coverage lanes and expert candidates. When the design summary is ready, call NextPhase({ phase: 'review' }); do not skip to write.",
      review:
        "Review Phase: Read-only tools + TodoList progress tracking (WebSearch, FetchURL, Context7Resolve/Docs, TaskList, TaskOutput). Re-check code and external claims, then call NextPhase({ phase: 'write' }).",
      write:
        'Write Phase: Only the current plan file may be edited; reading for verification is allowed. TodoList + NextPhase/ExitPlanMode available. Include Seed Spec, AC Tree, WorkGraph, Evaluation Plan, Execution Plan.',
      exit: 'Exit Phase: Plan complete — call ExitPlanMode for approval.',
    };
    return instructions[phase] ?? '';
  }
}
