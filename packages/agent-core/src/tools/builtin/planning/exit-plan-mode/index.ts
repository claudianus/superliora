/**
 * ExitPlanModeTool — plan-mode exit tool.
 *
 * The LLM calls this tool to surface a finalised plan to the user and
 * exit plan mode. The plan must already be written to the current plan
 * file; this tool reads that file and flips plan mode off.
 */

import type { Agent } from '#/agent/index';
import { seedTaskGraphFromApprovedPlan } from '#/agent/plan/work-graph-from-plan';
import type { PlanData } from '#/agent/plan';
import {
  combinedDrift,
  isDriftAcceptable,
  ULTRA_PLAN_DRIFT_THRESHOLD_AUTO,
} from '#/agent/plan/ultra-plan-mode';

import type { BuiltinTool } from '../../../../agent/tool';
import { ToolAccesses } from '../../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../../loop/types';
import type { ToolInputDisplay } from '../../../display';
import { toInputJsonSchema } from '../../../support/input-schema';
import DESCRIPTION from '../exit-plan-mode.md?raw';
import {
  formatPlanForOutput,
  formatUltraPlanMetrics,
  type UltraPlanDriftResult,
} from './output';
import {
  ExitPlanModeInputSchema,
  type ExitPlanModeInput,
  type ExitPlanModeOption,
  type ExitPlanModePlanSource,
} from './schema';
import {
  enforceSeedCoverage,
  missingUltraPlanSections,
} from './ultra-validation';

export type { ExitPlanModeInput, ExitPlanModeOption, ExitPlanModePlanSource };
export { ExitPlanModeInputSchema, enforceSeedCoverage };

type ResolvePlanResult =
  | { readonly ok: true; readonly plan: string; readonly path?: string | undefined }
  | { readonly ok: false; readonly error: ExecutableToolResult };

export class ExitPlanModeTool implements BuiltinTool<ExitPlanModeInput> {
  readonly name = 'ExitPlanMode' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ExitPlanModeInputSchema);

  constructor(private readonly agent: Agent) {}

  async resolveExecution(args: ExitPlanModeInput): Promise<ToolExecution> {
    return {
      accesses: ToolAccesses.all(),
      description: 'Presenting plan and exiting plan mode',
      display: await this.resolvePlanReviewDisplay(args),
      approvalRule: this.name,
      execute: () => this.execution(args),
    };
  }

  private async resolvePlanReviewDisplay(
    args: ExitPlanModeInput,
  ): Promise<ToolInputDisplay | undefined> {
    if (!this.agent.planMode.isActive) return undefined;
    let data: PlanData;
    try {
      data = await this.agent.planMode.data();
    } catch {
      return undefined;
    }
    if (data === null || data.content.trim().length === 0) return undefined;
    const display: ToolInputDisplay = {
      kind: 'plan_review',
      plan: data.content,
      path: data.path,
    };
    if (args.options !== undefined && args.options.length >= 2) {
      display.options = args.options;
    }
    return display;
  }

  private async execution(args: ExitPlanModeInput): Promise<ExecutableToolResult> {
    if (!this.agent.planMode.isActive) {
      return {
        isError: true,
        output:
          'ExitPlanMode can only be called while plan mode is active. Use EnterPlanMode (or /plan) first.',
      };
    }

    const isUltra = this.agent.planMode.isUltraMode;

    // Mission Ultra Plan: minimum artifacts are hard gates (not advisory-only).
    if (isUltra) {
      const phase = this.agent.planMode.phase;
      if (phase !== 'write' && phase !== 'exit') {
        return {
          isError: true,
          output: [
            `ExitPlanMode blocked: still in ${phase} phase.`,
            'Advance through research → interview → design → review → write with NextPhase, then call ExitPlanMode from write/exit.',
          ].join('\n'),
        };
      }

      const planData = await this.agent.planMode.data();
      const planContent = planData?.content ?? '';
      const missing = missingUltraPlanSections(planContent);
      if (missing.length > 0) {
        return {
          isError: true,
          output: [
            'ExitPlanMode blocked: Mission plan is missing minimum artifacts.',
            `Missing: ${missing.join(', ')}.`,
            'Required: Seed Spec completion criterion, AC Tree, WorkGraph, Fleet/Swarm decision line, Evaluation Plan, Execution Plan.',
            'Complete the plan file, then call ExitPlanMode again.',
          ].join('\n'),
        };
      }
    }

    const resolvedPlan = await this.resolvePlan();
    if (!resolvedPlan.ok) return resolvedPlan.error;

    const ultraDrift = isUltra ? await this.validateUltraPlanDrift(resolvedPlan.plan) : undefined;

    if (isUltra) {
      const missingSeedSections = enforceSeedCoverage(resolvedPlan.plan);
      if (missingSeedSections.length > 0) {
        return {
          isError: true,
          output: [
            'ExitPlanMode blocked: Seed Spec coverage incomplete.',
            `Missing sections: ${missingSeedSections.join(', ')}.`,
            'Fill Goal, Constraints, Acceptance, Ontology/WorkGraph, Evaluation before approval.',
          ].join('\n'),
        };
      }
    }

    this.agent.telemetry.track('plan_submitted', {
      has_options: args.options !== undefined && args.options.length >= 2,
      ultra: isUltra,
    });

    const failed = this.exitPlanMode();
    if (failed !== undefined) return failed;

    const seededWorkGraph = isUltra
      ? seedTaskGraphFromApprovedPlan(this.agent, resolvedPlan.plan, resolvedPlan.path)
      : { seeded: false, nodeIds: [] };

    this.agent.telemetry.track('plan_resolved', { outcome: 'auto_approved', ultra: isUltra });

    const output = formatPlanForOutput(
      resolvedPlan.plan,
      resolvedPlan.path,
      ultraDrift,
      seededWorkGraph,
    );
    return { isError: false, output };
  }

  private async validateUltraPlanDrift(plan: string): Promise<UltraPlanDriftResult> {
    const seed = this.agent.planMode.ultraEngine.seedSpec;
    const autoGenerated = seed?.autoGenerated ?? false;
    if (autoGenerated) {
      const metrics = await this.agent.planMode.ultraEngine.calculateDrift(plan, []);
      const combined = combinedDrift(metrics);
      this.agent.telemetry.track('ultra_plan_drift_soft_gate', { combined });
      if (combined <= ULTRA_PLAN_DRIFT_THRESHOLD_AUTO) {
        return {
          ok: true,
          metrics,
          warning:
            'The Seed Spec was auto-generated from the interview. Drift is within the tolerant threshold, but review the plan before approving. If the plan is wrong, cancel it and re-enter UltraPlan to refine the Seed.',
        };
      }
      // Fall through to the standard drift rejection path below.
    }

    const metrics = await this.agent.planMode.ultraEngine.calculateDrift(plan, []);
    if (isDriftAcceptable(metrics)) {
      return { ok: true, metrics };
    }
    // Drift is advisory: surface the metrics and let the model decide whether
    // to refine the Seed Spec or proceed. The harness no longer reopens the
    // interview or blocks approval on drift.
    return {
      ok: true,
      metrics,
      warning: [
        'Ultra Plan drift exceeds the accepted threshold: the plan may diverge from the Seed Spec.',
        formatUltraPlanMetrics(metrics),
        'If the plan is wrong, re-enter the UltraPlan interview/design phases and close the seed gap with 1-3 focused questions before executing.',
      ].join('\n\n'),
    };
  }

  private exitPlanMode(): ExecutableToolResult | undefined {
    try {
      this.agent.planMode.exit();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to exit plan mode.';
      return {
        isError: true,
        output: `Failed to exit plan mode: ${message}`,
      };
    }
  }

  private async resolvePlan(): Promise<ResolvePlanResult> {
    let source: ExitPlanModePlanSource | null;
    try {
      const data = await this.agent.planMode.data();
      source = data === null ? null : { plan: data.content, path: data.path };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read plan file.';
      return {
        ok: false,
        error: { isError: true, output: `Failed to read plan file: ${message}` },
      };
    }

    if (source !== null && source.plan.trim().length > 0) {
      return {
        ok: true,
        plan: source.plan,
        path: source.path,
      };
    }

    const path = source?.path ?? this.agent.planMode.planFilePath;
    return {
      ok: false,
      error: {
        isError: true,
        output:
          path === null
            ? 'No plan file found. Write the plan to the current plan file first, then call ExitPlanMode.'
            : `No plan file found. Write your plan to ${path} first, then call ExitPlanMode.`,
      },
    };
  }
}
