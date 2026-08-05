/**
 * NextPhaseTool — Ultra Plan Mode phase transition tool.
 *
 * Canonical order: research → interview → design → review → write → exit.
 * Fast path (Ouroboros-aligned): interview→write and design→write may skip
 * optional design/review when the UltraGoal is already verifiable.
 *
 * Hard rules:
 * - No reverse; no arbitrary skips except the documented fast paths.
 * - interview→design|write requires verifiable goal OR force_unverified + reason.
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

/** One-step forward, or documented fast-path skips (interview/design → write). */
export function isAllowedUltraPlanAdvance(
  current: string,
  target: string,
): boolean {
  if (isForwardOneStepPhase(current, target)) return true;
  if (current === 'interview' && target === 'write') return true;
  if (current === 'design' && target === 'write') return true;
  return false;
}

export class NextPhaseTool implements BuiltinTool<NextPhaseInput> {
  readonly name = 'NextPhase' as const;
  readonly description = `Advance Ultra Plan phases. Call when the current phase is complete.

- research → interview: after a compact evidence pack (research is optional — may already be in interview)
- interview → write (preferred fast path) or interview → design: HARD gate — UltraGoal must be true/false-verifiable (ambiguity ≤ 0.2). Else force_unverified=true + override_reason
- design → write (skip review) or design → review → write: use review only when architecture still open
- write → exit: then ExitPlanMode

Do not reverse. Do not use EnterPlanMode to advance phases.`;
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
    if (!isAllowedUltraPlanAdvance(currentPhase, targetPhase)) {
      const expected = nextUltraPlanPhase(currentPhase);
      return {
        isError: true,
        output:
          expected === undefined
            ? `Cannot advance from ${currentPhase}: already at the last plan phase (exit). Call ExitPlanMode.`
            : `Cannot reverse or skip arbitrarily: currently in ${currentPhase}; next is ${expected}, or from interview/design you may jump to write (requested ${targetPhase}).`,
      };
    }

    let overrideNote: string | undefined;
    const leavingInterview =
      currentPhase === 'interview' && (targetPhase === 'design' || targetPhase === 'write');
    if (leavingInterview) {
      // Avoid a second LLM rescore when readiness was just computed this turn.
      const readiness = await this.agent.planMode.ultraEngine.interviewReadiness({ rescore: false });
      if (!readiness.ready) {
        const force = args.force_unverified === true;
        const reason = args.override_reason?.trim() ?? '';
        if (!force || reason.length === 0) {
          const blocker = await this.agent.planMode.ultraEngine.readinessBlockerMessage(readiness);
          return {
            isError: true,
            output: [
              `NextPhase interview→${targetPhase} blocked: UltraGoal is not yet true/false-verifiable (aim ambiguity ≤ 0.2).`,
              'Finish interview until READY, or pass force_unverified=true with override_reason.',
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
        (args.force_unverified === true && !readiness.ready) ||
        targetPhase === 'write';
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
      if (targetPhase === 'write' && currentPhase === 'interview') {
        overrideNote = [overrideNote, 'Fast path: skipped design/review (interview→write).']
          .filter(Boolean)
          .join(' ');
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
        "Interview Phase: Socratic interviewer only — ontological questions, Baseline + Upgrade. PATH 1 RecordInterviewFinding(code); PATH 2 AskUserQuestion; PATH 3 research then RecordInterviewFinding(research). After 3 consecutive non-user findings, must AskUserQuestion. When UltraGoal is verifiable (ambiguity ≤ 0.2), prefer NextPhase({ phase: 'write' }); use design only if architecture is still open.",
      design:
        "Design Phase (optional): converge on one approach. Prefer NextPhase({ phase: 'write' }); use review only if verification against code is still needed.",
      review:
        "Review Phase (optional): re-check code and external claims, then NextPhase({ phase: 'write' }).",
      write:
        'Write Phase: Only the plan file (and evidence root) may be edited. Include Seed Spec, AC Tree, WorkGraph, Evaluation Plan, Execution Plan. Then ExitPlanMode.',
      exit: 'Exit Phase: Plan complete — call ExitPlanMode for approval.',
    };
    return instructions[phase] ?? '';
  }
}
