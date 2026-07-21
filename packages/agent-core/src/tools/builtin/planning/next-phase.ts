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

export const NextPhaseInputSchema = z.object({
  phase: z.enum(['research', 'interview', 'design', 'review', 'write', 'exit']).describe(
    'The target phase to navigate to.',
  ),
  advance_with_defaults: z
    .boolean()
    .optional()
    .describe(
      'Only valid for interview→design. Soft-fills remaining seed gaps with conservative defaults; useful when advancing with a not-yet-verifiable UltraGoal.',
    ),
}).strict();

export type NextPhaseInput = z.infer<typeof NextPhaseInputSchema>;

export class NextPhaseTool implements BuiltinTool<NextPhaseInput> {
  readonly name = 'NextPhase' as const;
  readonly description = `Advance to the next phase in Ultra Plan Mode workflow. Call when the current phase is complete.

- research → interview: after a compact evidence pack for upcoming questions
- interview → design: recommended once the UltraGoal is verifiable (readiness READY). Verifiability, soft seed gaps, and ambiguity floors are recommendations, not hard blockers — advancing before READY appends a non-blocking warning. Capture a true/false Completion Criterion via AskUserQuestion when you can; do not Write the plan file or repeat resolved questions.
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

    const allPhases = ['research', 'interview', 'design', 'review', 'write', 'exit'];
    if (!allPhases.includes(targetPhase)) {
      return {
        isError: true,
        output: `Unknown target phase: ${targetPhase}. Valid phases: ${allPhases.join(', ')}.`,
      };
    }
    if (currentPhase === targetPhase) {
      return {
        isError: true,
        output: `Already in ${currentPhase} phase.`,
      };
    }

    let verifiabilityWarning: string | undefined;
    if (currentPhase === 'interview' && targetPhase === 'design') {
      const readiness = await this.agent.planMode.ultraEngine.interviewReadiness({ rescore: true });
      // Verifiability is advisory: a not-yet-verifiable UltraGoal appends the
      // readiness guide as a non-blocking warning instead of halting the
      // workflow. Seed gaps are soft-filled so design always has a Seed Spec.
      if (!readiness.ready) {
        verifiabilityWarning = await this.agent.planMode.ultraEngine.readinessBlockerMessage(readiness);
      }
      const softFillDefaults = args.advance_with_defaults === true || !readiness.ready;
      if (this.agent.planMode.ultraEngine.seedSpec === null || softFillDefaults) {
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

    let output = `Advanced from ${currentPhase} phase to ${targetPhase} phase.\n\n${this.phaseInstructions(targetPhase)}`;
    if (verifiabilityWarning !== undefined) {
      output += `\n\n---\n## Advisory (non-blocking): UltraGoal not yet verifiable\n${verifiabilityWarning}`;
    }
    return { output };
  }

  private phaseInstructions(phase: string): string {
    const instructions: Record<string, string> = {
      interview:
        "Interview Phase: Act as an expert leader — teach brief insights, surface unknown-unknowns, Baseline + Upgrade choices with read-only research. PATH 1/3 → RecordInterviewFinding; PATH 2 → AskUserQuestion. After 3 consecutive non-user findings, must AskUserQuestion. When the UltraGoal is verifiable, call NextPhase({ phase: 'design' }). Soft seed gaps may still be auto-filled; they are not Design blockers.",
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
