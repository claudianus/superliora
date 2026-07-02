/**
 * ExitPlanModeTool — plan-mode exit tool.
 *
 * The LLM calls this tool to surface a finalised plan to the user and
 * exit plan mode. The plan must already be written to the current plan
 * file; this tool reads that file and flips plan mode off.
 */

import type { Agent } from '#/agent';
import type { PlanData } from '#/agent/plan';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { ToolInputDisplay } from '../../display';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './exit-plan-mode.md?raw';

// ── Input schema ─────────────────────────────────────────────────────

/**
 * User-selectable option surfaced at plan approval time. The LLM supplies
 * up to 3 of these when the plan contains multiple approaches; the host's
 * ApprovalRuntime presents them to the user and returns the chosen `label`
 * (or `{kind:'revise', feedback}` when the user asks for revisions).
 */
export interface ExitPlanModeOption {
  label: string;
  description: string;
}

export interface ExitPlanModeInput {
  options?: readonly ExitPlanModeOption[] | undefined;
}

const RESERVED_OPTION_LABELS = new Set(
  ['Approve', 'Reject', 'Reject and Exit', 'Revise'].map(normalizeOptionLabel),
);

const ExitPlanModeOptionSchema = z
  .object({
    label: z
      .string()
      .min(1)
      .max(80)
      .describe(
        'Short name for this option (1-8 words). Append "(Recommended)" if you recommend this option.',
      ),
    description: z
      .string()
      .default('')
      .describe('Brief summary of this approach and its trade-offs.'),
  })
  .strict();

export const ExitPlanModeInputSchema: z.ZodType<ExitPlanModeInput> = z
  .object({
    options: z
      .array(ExitPlanModeOptionSchema)
      .min(1)
      .max(3)
      .refine(hasUniqueOptionLabels, 'Option labels must be unique.')
      .refine(hasNoReservedOptionLabels, 'Option labels must not use reserved approval labels.')
      .optional()
      .describe(
        'When the plan contains multiple alternative approaches, list them here so the user can choose which one to execute. Provide up to 3 options; 2-3 distinct approaches work best when the plan offers a real choice. Passing a single option is allowed and is equivalent to a plain plan approval. Each option represents a distinct approach from the plan. Do not use "Reject", "Revise", "Approve", or "Reject and Exit" as labels.',
      ),
  })
  .strict();

export interface ExitPlanModePlanSource {
  plan: string;
  path?: string | undefined;
}

type ResolvePlanResult =
  | { readonly ok: true; readonly plan: string; readonly path?: string | undefined }
  | { readonly ok: false; readonly error: ExecutableToolResult };

// ── Implementation ───────────────────────────────────────────────────

export class ExitPlanModeTool implements BuiltinTool<ExitPlanModeInput> {
  readonly name = 'ExitPlanMode' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ExitPlanModeInputSchema);

  constructor(private readonly agent: Agent) {}

  async resolveExecution(args: ExitPlanModeInput): Promise<ToolExecution> {
    return {
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

    // Ultra Plan Mode: enforce phase workflow
    if (isUltra) {
      const phase = this.agent.planMode.phase;
      if (phase !== 'write' && phase !== 'exit') {
        return {
          isError: true,
          output: `ExitPlanMode is blocked in ${phase} phase. Complete the current phase and use NextPhase to advance through the workflow: research -> interview -> design -> review -> write -> exit.`,
        };
      }

      // Verify plan file contains the full UltraPlan Seed contract.
      const planData = await this.agent.planMode.data();
      const planContent = planData?.content ?? '';
      const missing = missingUltraPlanSections(planContent);
      if (missing.length > 0) {
        return {
          isError: true,
          output: `ExitPlanMode blocked: the Ultra Plan file is missing required sections: ${missing.join(', ')}. Write the complete verifiable UltraGoal Seed contract before exiting.`,
        };
      }
    }

    const resolvedPlan = await this.resolvePlan();
    if (!resolvedPlan.ok) return resolvedPlan.error;

    this.agent.telemetry.track('plan_submitted', {
      has_options: args.options !== undefined && args.options.length >= 2,
      ultra: isUltra,
    });

    const failed = this.exitPlanMode();
    if (failed !== undefined) return failed;

    this.agent.telemetry.track('plan_resolved', { outcome: 'auto_approved', ultra: isUltra });

    return {
      isError: false,
      output: formatPlanForOutput(resolvedPlan.plan, resolvedPlan.path, isUltra, this.agent),
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

function missingUltraPlanSections(plan: string): string[] {
  const missing: string[] = [];
  const requiredHeadings = [
    'Seed Spec',
    'AC Tree',
    'Evaluation Plan',
    'Execution Plan',
  ];
  const fieldRequirements: readonly FieldRequirement[] = [
    { label: 'Verifiable UltraGoal', aliases: ['Verifiable UltraGoal'] },
    { label: 'Completion Criterion', aliases: ['Completion Criterion'] },
    { label: 'Actors', aliases: ['Actors'] },
    { label: 'Inputs', aliases: ['Inputs'] },
    { label: 'Outputs', aliases: ['Outputs'] },
    { label: 'Constraints', aliases: ['Constraints'] },
    { label: 'Non-goals', aliases: ['Non-goals', 'Non goals'] },
    { label: 'Acceptance Criteria', aliases: ['Acceptance Criteria'] },
    { label: 'Verification Plan', aliases: ['Verification Plan'] },
    { label: 'Failure Modes', aliases: ['Failure Modes'] },
    { label: 'Runtime Context', aliases: ['Runtime Context'] },
  ];

  for (const heading of requiredHeadings) {
    if (!hasHeading(plan, heading)) missing.push(heading);
  }
  if (!hasHeading(plan, 'Swarm Decision') && !hasSwarmDecisionLine(plan)) {
    missing.push('Swarm Decision');
  }
  for (const requirement of fieldRequirements) {
    if (!hasFieldContent(plan, requirement.aliases)) missing.push(requirement.label);
  }
  if (!hasSwarmDecisionLine(plan)) missing.push('Swarm decision audit line');
  if (!hasSwarmDecisionField(plan, 'Decision')) missing.push('Decision');
  if (!hasSwarmDecisionField(plan, 'Reason')) missing.push('Reason');
  if (!hasSwarmDecisionField(plan, 'Specialist value')) missing.push('Specialist value');
  if (!hasSwarmDecisionField(plan, 'Verification owner')) missing.push('Verification owner');
  if (swarmDecision(plan) === 'DEFER' && !hasSwarmDeferWaiver(plan)) {
    missing.push('Swarm DEFER waiver');
  }
  return missing;
}

interface FieldRequirement {
  readonly label: string;
  readonly aliases: readonly string[];
}

const ALL_ULTRA_PLAN_FIELD_LABELS = [
  'Seed Spec',
  'AC Tree',
  'Ontology',
  'Swarm Decision',
  'Evaluation Plan',
  'Execution Plan',
  'Verifiable UltraGoal',
  'Completion Criterion',
  'Actors',
  'Inputs',
  'Outputs',
  'Constraints',
  'Non-goals',
  'Acceptance Criteria',
  'Verification Plan',
  'Failure Modes',
  'Runtime Context',
  'Decision',
  'Reason',
  'Specialist value',
  'Verification owner',
  'Swarm DEFER waiver',
  'Swarm defer waiver',
  'DEFER waiver',
];

function hasHeading(plan: string, heading: string): boolean {
  return new RegExp(`^\\s*#{2,}\\s+${escapeRegExp(heading)}\\b`, 'im').test(plan);
}

function hasFieldContent(plan: string, labels: readonly string[]): boolean {
  const lines = plan.split(/\r?\n/);
  const labelPattern = fieldLabelPattern(labels);
  const anyFieldPattern = fieldLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  const headingPattern = headingLabelPattern(labels);
  const anyHeadingPattern = headingLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = labelPattern.exec(line);
    if (match === null) continue;
    if ((match.groups?.['value'] ?? '').trim().length > 0) return true;
    if (hasFollowingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern)) return true;
  }
  for (let index = 0; index < lines.length; index++) {
    if (!headingPattern.test(lines[index] ?? '')) continue;
    if (hasFollowingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern)) return true;
  }
  return false;
}

function hasSwarmDecisionLine(plan: string): boolean {
  return /\bswarm decision\s*:\s*(?:ENGAGE|DEFER)\b/i.test(plan);
}

function swarmDecision(plan: string): 'ENGAGE' | 'DEFER' | undefined {
  const lineMatch = /\bswarm decision\s*:\s*(ENGAGE|DEFER)\b/i.exec(plan);
  if (lineMatch?.[1] !== undefined) return lineMatch[1].toUpperCase() as 'ENGAGE' | 'DEFER';
  const fieldMatch =
    /^\s*(?:[-*+•]|\d+[.)])?\s*(?:\*\*)?Decision(?:\*\*)?\s*:\s*(ENGAGE|DEFER)\b/im.exec(plan);
  if (fieldMatch?.[1] !== undefined) return fieldMatch[1].toUpperCase() as 'ENGAGE' | 'DEFER';
  return undefined;
}

function hasSwarmDeferWaiver(plan: string): boolean {
  return (
    hasMeaningfulFieldContent(plan, ['Swarm DEFER waiver', 'Swarm defer waiver', 'DEFER waiver']) ||
    hasMeaningfulHeadingContent(plan, ['Swarm DEFER Waiver', 'Swarm defer waiver', 'DEFER waiver'])
  );
}

function hasMeaningfulFieldContent(plan: string, labels: readonly string[]): boolean {
  const lines = plan.split(/\r?\n/);
  const labelPattern = fieldLabelPattern(labels);
  const anyFieldPattern = fieldLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  const anyHeadingPattern = headingLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = labelPattern.exec(line);
    if (match === null) continue;
    const inline = (match.groups?.['value'] ?? '').trim();
    if (isMeaningfulWaiverText(inline)) return true;
    const following = followingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern);
    if (isMeaningfulWaiverText(following)) return true;
  }
  return false;
}

function hasMeaningfulHeadingContent(plan: string, headings: readonly string[]): boolean {
  const lines = plan.split(/\r?\n/);
  const headingPattern = headingLabelPattern(headings);
  const anyFieldPattern = fieldLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  const anyHeadingPattern = headingLabelPattern(ALL_ULTRA_PLAN_FIELD_LABELS);
  for (let index = 0; index < lines.length; index++) {
    if (!headingPattern.test(lines[index] ?? '')) continue;
    const following = followingFieldContent(lines, index, anyFieldPattern, anyHeadingPattern);
    if (isMeaningfulWaiverText(following)) return true;
  }
  return false;
}

function followingFieldContent(
  lines: readonly string[],
  startIndex: number,
  anyFieldPattern: RegExp,
  anyHeadingPattern: RegExp,
): string | undefined {
  for (let next = startIndex + 1; next < lines.length; next++) {
    const line = lines[next] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (anyFieldPattern.test(line) || anyHeadingPattern.test(line)) break;
    return trimmed;
  }
  return undefined;
}

function isMeaningfulWaiverText(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length < 12) return false;
  return !/^(?:none|n\/a|na|not applicable|not needed|no|없음|불필요|해당 없음)[.。!！\s]*$/i.test(
    trimmed,
  );
}

function hasSwarmDecisionField(plan: string, label: string): boolean {
  if (hasFieldContent(plan, [label])) return true;
  switch (label) {
    case 'Decision':
      return /\bswarm decision\s*:\s*(?:ENGAGE|DEFER)\b/i.test(plan);
    case 'Reason':
      return /\bswarm decision\s*:\s*(?:ENGAGE|DEFER)\s*(?:[.:\-—]\s*\S|.*\breason\s*:)/i.test(plan);
    case 'Specialist value':
      return /\bvalue\s*:\s*\S/i.test(plan);
    case 'Verification owner':
      return /\bowner\s*:\s*\S/i.test(plan);
    default:
      return false;
  }
}

function hasFollowingFieldContent(
  lines: readonly string[],
  startIndex: number,
  anyFieldPattern: RegExp,
  anyHeadingPattern: RegExp,
): boolean {
  for (let next = startIndex + 1; next < lines.length; next++) {
    const line = lines[next] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (anyFieldPattern.test(line) || anyHeadingPattern.test(line)) break;
    return true;
  }
  return false;
}

function fieldLabelPattern(labels: readonly string[]): RegExp {
  const labelAlternation = labels.map(escapeRegExp).join('|');
  return new RegExp(
    `^\\s*(?:[-*+•]|\\d+[.)])?\\s*(?:\\*\\*)?(?:${labelAlternation})(?:\\*\\*)?\\s*:\\s*(?<value>.*)$`,
    'i',
  );
}

function headingLabelPattern(labels: readonly string[]): RegExp {
  const labelAlternation = labels.map(escapeRegExp).join('|');
  return new RegExp(`^\\s*#{2,}\\s+(?:${labelAlternation})\\b`, 'i');
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasUniqueOptionLabels(options: readonly ExitPlanModeOption[]): boolean {
  const labels = new Set<string>();
  for (const option of options) {
    const label = normalizeOptionLabel(option.label);
    if (labels.has(label)) return false;
    labels.add(label);
  }
  return true;
}

function hasNoReservedOptionLabels(options: readonly ExitPlanModeOption[]): boolean {
  return options.every((option) => !RESERVED_OPTION_LABELS.has(normalizeOptionLabel(option.label)));
}

function normalizeOptionLabel(label: string): string {
  return label.trim().toLowerCase();
}

function formatPlanForOutput(plan: string, path: string | undefined, isUltra: boolean, agent: Agent): string {
  const savedTo = path !== undefined ? `Plan saved to: ${path}\n\n` : '';
  let output = `Plan mode deactivated. All tools are now available.\n${savedTo}## Approved Plan:\n${plan}`;

  if (isUltra) {
    const drift = agent.planMode.ultraEngine.calculateDrift(plan, []);
    const combined = (drift.goalDrift * 0.5 + drift.constraintDrift * 0.3 + drift.ontologyDrift * 0.2).toFixed(3);
    output += `\n\n---\n## Ultra Plan Metrics\n`;
    output += `- Goal Drift: ${drift.goalDrift.toFixed(3)}\n`;
    output += `- Constraint Drift: ${drift.constraintDrift.toFixed(3)}\n`;
    output += `- Ontology Drift: ${drift.ontologyDrift.toFixed(3)}\n`;
    output += `- Combined Drift: ${combined} (threshold: 0.3)\n`;
    output += `- Status: ${Number(combined) <= 0.3 ? 'ACCEPTABLE' : 'WARNING — plan may deviate from seed spec'}\n`;
  }

  return output;
}
