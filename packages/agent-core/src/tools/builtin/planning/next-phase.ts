/**
 * NextPhaseTool — Ultra Plan Mode phase transition tool.
 *
 * The LLM calls this tool to advance to the next phase in the ultra plan
 * workflow: research → interview → design → review → write → exit.
 *
 * Hard rules (Mission harness reform):
 * - Forward-only, exactly one step (no skip, no reverse).
 * - interview→design requires verifiable goal OR explicit force_unverified override
 *   (recorded in tool output / telemetry). Silent soft-pass is not allowed.
 */

import type { Agent } from '#/agent/index';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

export const ULTRA_PLAN_PHASE_ORDER = [
  'research',
  'interview',
  'design',
  'review',
  'write',
  'exit',
] as const;

export type UltraPlanPhaseName = (typeof ULTRA_PLAN_PHASE_ORDER)[number];

export const NextPhaseInputSchema = z.object({
  phase: z.enum(['research', 'interview', 'design', 'review', 'write', 'exit']).describe(
    'The target phase to navigate to. Must be exactly one step forward from the current phase.',
  ),
  advance_with_defaults: z
    .boolean()
    .optional()
    .describe(
      'Only valid for interview→design when force_unverified is also true. Soft-fills remaining seed gaps with conservative defaults after an explicit unverified override.',
    ),
  force_unverified: z
    .boolean()
    .optional()
    .describe(
      'Only for interview→design. When true, allows advance even if the Goal is not yet true/false-verifiable. Requires a short override_reason. Prefer finishing interview to READY instead.',
    ),
  override_reason: z
    .string()
    .optional()
    .describe(
      'Required when force_unverified=true. Short English reason recorded for the run audit trail.',
    ),
}).strict();

export type NextPhaseInput = z.infer<typeof NextPhaseInputSchema>;

export function nextUltraPlanPhase(
  current: string,
): UltraPlanPhaseName | undefined {
  const index = ULTRA_PLAN_PHASE_ORDER.indexOf(current as UltraPlanPhaseName);
  if (index < 0 || index >= ULTRA_PLAN_PHASE_ORDER.length - 1) return undefined;
  return ULTRA_PLAN_PHASE_ORDER[index + 1];
}

export function isForwardOneStepPhase(
  current: string,
  target: string,
): boolean {
  return nextUltraPlanPhase(current) === target;
}

export class NextPhaseTool implements BuiltinTool<NextPhaseInput> {
  readonly name = 'NextPhase' as const;
  readonly description = `Advance to the next phase in Mission Ultra Plan workflow. Call when the current phase is complete.

- research → interview: after a compact evidence pack for upcoming questions
- interview → design: HARD gate — Goal must be true/false-verifiable (readiness READY). To advance without verifiability you MUST pass force_unverified=true and override_reason (recorded). Soft seed fill alone cannot bypass.
- design → review → write → exit: advance exactly one phase at a time

Forward only, never skip or reverse. Do not use EnterPlanMode to advance phases.`;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(NextPhaseInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: NextPhaseInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
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
        output: 'NextPhase is only available in Ultra Plan mode (Mission).',
      };
    }

    const currentPhase = this.agent.planMode.phase;
    const targetPhase = args.phase;

    if (!ULTRA_PLAN_PHASE_ORDER.includes(targetPhase)) {
      return {
        isError: true,
        output: `Unknown target phase: ${targetPhase}. Valid phases: ${ULTRA_PLAN_PHASE_ORDER.join(', ')}.`,
      };
    }
    if (currentPhase === targetPhase) {
      return {
        isError: true,
        output: `Already in ${currentPhase} phase.`,
      };
    }
    if (!isForwardOneStepPhase(currentPhase, targetPhase)) {
      const expected = nextUltraPlanPhase(currentPhase);
      return {
        isError: true,
        output:
          expected === undefined
            ? `Cannot advance from ${currentPhase}: already at the last plan phase (exit). Call ExitPlanMode.`
            : `Cannot skip or reverse phases: currently in ${currentPhase}; next allowed phase is ${expected} (requested ${targetPhase}).`,
      };
    }

    let overrideNote: string | undefined;
    if (currentPhase === 'interview' && targetPhase === 'design') {
      const readiness = await this.agent.planMode.ultraEngine.interviewReadiness({ rescore: true });
      if (!readiness.ready) {
        const force = args.force_unverified === true;
        const reason = args.override_reason?.trim() ?? '';
        if (!force || reason.length === 0) {
          const blocker = await this.agent.planMode.ultraEngine.readinessBlockerMessage(readiness);
          return {
            isError: true,
            output: [
              'NextPhase interview→design blocked: UltraGoal is not yet true/false-verifiable.',
              'Finish interview questions until readiness READY, or pass force_unverified=true with override_reason.',
              '',
              blocker,
            ].join('\n'),
          };
        }
        overrideNote = `force_unverified override recorded: ${reason}`;
        this.agent.telemetry.track('ultra_plan_force_unverified', {
          from: currentPhase,
          to: targetPhase,
          reason,
        });
        this.agent.planMode.ultraEngine.addInterviewRound(
          '[force_unverified override]',
          reason,
          'auto',
        );
      }

      const softFillDefaults =
        args.advance_with_defaults === true ||
        (args.force_unverified === true && !readiness.ready);
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
    this.agent.telemetry.track('ultra_plan_phase_transition', {
      from: currentPhase,
      to: targetPhase,
    });

    let output = `Advanced from ${currentPhase} phase to ${targetPhase} phase.\n\n${this.phaseInstructions(targetPhase)}`;
    if (overrideNote !== undefined) {
      output += `\n\n---\n## Recorded override\n${overrideNote}`;
    }
    return { output };
  }

  private phaseInstructions(phase: string): string {
    const instructions: Record<string, string> = {
      interview:
        "Interview Phase (Mission): Act as an expert leader — Baseline + Upgrade choices with evidence. PATH 1 → RecordInterviewFinding; PATH 2 → AskUserQuestion. After 3 consecutive non-user findings, must AskUserQuestion. When the Goal is verifiable, call NextPhase({ phase: 'design' }). force_unverified requires override_reason.",
      design:
        "Design Phase: Read-only tools + TodoList progress tracking (Context7Resolve/Docs, WebSearch/FetchURL, Liora*, SearchSkill/Skill/SearchExpert, Bash read-only). Explore coverage lanes and expert candidates. When the design summary is ready, call NextPhase({ phase: 'review' }); do not skip to write.",
      review:
        "Review Phase: Read-only tools + TodoList progress tracking (WebSearch, FetchURL, Context7Resolve/Docs, TaskList, TaskOutput). Re-check code and external claims, then call NextPhase({ phase: 'write' }).",
      write:
        'Write Phase: Only the Mission plan file and evidence root may be edited; reading for verification is allowed. TodoList + NextPhase/ExitPlanMode available. Include Seed Spec, AC Tree, WorkGraph, Fleet/Swarm decision, Evaluation Plan, Execution Plan.',
      exit: 'Exit Phase: Plan complete — call ExitPlanMode for approval.',
    };
    return instructions[phase] ?? '';
  }
}
