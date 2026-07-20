/**
 * ExitPlanModeTool — plan-mode exit tool.
 *
 * The LLM calls this tool to surface a finalised plan to the user and
 * exit plan mode. The plan must already be written to the current plan
 * file; this tool reads that file and flips plan mode off.
 */

import type { Agent } from '#/agent';
import {
  formatSeededWorkGraphNotice,
  seedUltraworkGraphFromApprovedPlan,
} from '#/agent/plan/work-graph-from-plan';
import { maybeAdvanceUltraworkStage, maybeFinishUltraworkRun } from '../../../ultrawork';
import {
  ultraSwarmDecision,
  ultraSwarmEngageNextAction,
} from '#/agent/plan/ultra-swarm-decision';
import { routeFromPlanSignals } from '#/agent/plan/ultra-swarm-routing';
import type { PlanData } from '#/agent/plan';
import {
  combinedDrift,
  isDriftAcceptable,
  ULTRA_PLAN_DRIFT_THRESHOLD,
  ULTRA_PLAN_DRIFT_THRESHOLD_AUTO,
  type DriftMetrics,
} from '#/agent/plan/ultra-plan-mode';
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

type UltraPlanDriftResult =
  | { readonly ok: true; readonly metrics: DriftMetrics; readonly warning?: string }
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

    const ultraDrift = isUltra ? await this.validateUltraPlanDrift(resolvedPlan.plan) : undefined;
    if (ultraDrift?.ok === false) return ultraDrift.error;

    if (isUltra) {
      const missingSeedSections = enforceSeedCoverage(resolvedPlan.plan);
      if (missingSeedSections.length > 0) {
        return {
          isError: true,
          output: [
            'ExitPlanMode blocked: the Ultra Plan does not cover all Seed Spec sections.',
            `Missing section(s): ${missingSeedSections.join(', ')}`,
            'Reopen the interview and fill the missing Seed sections before exiting.',
          ].join('\n\n'),
        };
      }
    }

    this.agent.telemetry.track('plan_submitted', {
      has_options: args.options !== undefined && args.options.length >= 2,
      ultra: isUltra,
    });

    const swarmDecision = ultraSwarmDecision(resolvedPlan.plan);
    const engageUltraSwarm = isUltra && (swarmDecision === 'ENGAGE' || swarmDecision === 'ADAPTIVE');
    const failed = this.exitPlanMode();
    if (failed !== undefined) return failed;

    const seededWorkGraph = isUltra
      ? seedUltraworkGraphFromApprovedPlan(this.agent, resolvedPlan.plan, resolvedPlan.path)
      : { seeded: false, nodeIds: [] };

    if (isUltra) {
      maybeAdvanceUltraworkStage(this.agent, 'goal', 'UltraPlan approved');
      if (seededWorkGraph.seeded) {
        this.agent.ultrawork.syncWorkGraphFromStore();
        await maybeFinishUltraworkRun(this.agent);
      }
      // Ensure the UltraGoal exists after plan approval so the goal driver
      // keeps the model running autonomously. Without a goal, the turn ends
      // after plan approval and the run stalls — the model has no
      // continuation loop. The /goal path creates the goal upfront; this
      // mirrors that for the /ultrawork path. The model can still refine the
      // goal via CreateGoal(replace: true) or UpdateGoal.
      const existingGoal = this.agent.goal?.getGoal().goal;
      if (existingGoal === undefined || existingGoal === null) {
        const runObjective = this.agent.ultrawork.getRun()?.objective;
        if (runObjective !== undefined && runObjective.length > 0) {
          await this.agent.goal.createGoal({ objective: runObjective, source: 'ultrawork' }, 'runtime');
        }
      }
    }

    if (engageUltraSwarm) {
      this.agent.ultraSwarmEngageGate?.engage({
        planPath: resolvedPlan.path,
        reason: swarmDecisionSummary(resolvedPlan.plan),
        routing: routeFromPlanSignals(resolvedPlan.plan) ?? undefined,
      });
    }

    this.agent.telemetry.track('plan_resolved', { outcome: 'auto_approved', ultra: isUltra });

    return {
      isError: false,
      output: formatPlanForOutput(
        resolvedPlan.plan,
        resolvedPlan.path,
        ultraDrift,
        seededWorkGraph,
      ),
    };
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
    this.agent.planMode.reopenUltraInterviewForDrift(metrics);
    return {
      ok: false,
      error: {
        isError: true,
        output: [
          'ExitPlanMode blocked: Ultra Plan drift exceeds the accepted threshold.',
          formatUltraPlanMetrics(metrics),
          'Ultra Plan interview has been reopened because the Seed Spec is not specific enough to anchor the plan.',
          'Do not keep rewriting the plan from Exit phase. Ask 1-3 focused AskUserQuestion questions to close the seed gap, then advance through NextPhase -> Design -> Review -> Write -> Exit with the regenerated Seed Spec.',
        ].join('\n\n'),
      },
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
  // Heading requirements accept English and Korean aliases; the response
  // language lock may force localized headings in the plan file.
  const requiredHeadingGroups: readonly FieldRequirement[] = [
    { label: 'Seed Spec', aliases: ['Seed Spec', '시드 사양', '시드 스펙'] },
    {
      label: 'AC Tree',
      aliases: ['AC Tree', 'AC 트리', 'AC트리', '인수 기준 트리'],
    },
    { label: 'WorkGraph', aliases: WORK_GRAPH_HEADING_ALIASES },
    { label: 'Evaluation Plan', aliases: ['Evaluation Plan', '평가 계획'] },
    { label: 'Execution Plan', aliases: ['Execution Plan', '실행 계획'] },
  ];
  const fieldRequirements: readonly FieldRequirement[] = [
    {
      label: 'Verifiable UltraGoal',
      aliases: ['Verifiable UltraGoal', '검증 가능한 목표', '검증 가능 목표'],
    },
    { label: 'Completion Criterion', aliases: ['Completion Criterion', '완료 기준'] },
    { label: 'Actors', aliases: ['Actors', '참여자', '액터'] },
    { label: 'Inputs', aliases: ['Inputs', '입력'] },
    { label: 'Outputs', aliases: ['Outputs', '출력', '산출물'] },
    { label: 'Constraints', aliases: ['Constraints', '제약', '제약 조건'] },
    { label: 'Non-goals', aliases: ['Non-goals', 'Non goals', '비목표', '비-목표'] },
    {
      label: 'Acceptance Criteria',
      aliases: ['Acceptance Criteria', '인수 기준', '수용 기준'],
    },
    { label: 'Verification Plan', aliases: ['Verification Plan', '검증 계획'] },
    { label: 'Failure Modes', aliases: ['Failure Modes', '실패 모드'] },
    { label: 'Runtime Context', aliases: ['Runtime Context', '런타임 컨텍스트'] },
  ];

  for (const group of requiredHeadingGroups) {
    if (!group.aliases.some((alias) => hasHeading(plan, alias))) missing.push(group.label);
  }
  if (
    !hasHeading(plan, 'Swarm Decision') &&
    !hasHeading(plan, '스웜 결정') &&
    !hasSwarmDecisionLine(plan)
  ) {
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
  if (ultraSwarmDecision(plan) === 'DEFER' && !hasSwarmDeferWaiver(plan)) {
    missing.push('Swarm DEFER waiver');
  }
  missing.push(...missingWorkGraphRequirements(plan));
  return missing;
}

/**
 * Verify that the approved plan covers the five Seed Spec sections:
 * Goal, Constraints, Acceptance (Criteria), Ontology, and Evaluation.
 * This is a second-layer guard applied after drift validation succeeds.
 */
export function enforceSeedCoverage(plan: string): string[] {
  const missing: string[] = [];
  const seedSections: readonly { readonly name: string; readonly aliases: readonly string[] }[] = [
    {
      name: 'Goal',
      aliases: ['Verifiable UltraGoal', 'Goal / UltraGoal', 'UltraGoal', '검증 가능한 목표', '검증 가능 목표'],
    },
    { name: 'Constraints', aliases: ['Constraints', '제약', '제약 조건'] },
    { name: 'Acceptance', aliases: ['Acceptance Criteria', '인수 기준', '수용 기준'] },
    { name: 'Ontology', aliases: ['Ontology', 'WorkGraph', 'AC Tree', '워크그래프', 'AC 트리', 'AC트리'] },
    { name: 'Evaluation', aliases: ['Evaluation Plan', 'Evaluation', '평가 계획'] },
  ];
  for (const section of seedSections) {
    if (!section.aliases.some((alias) => hasFieldContent(plan, [alias]))) {
      missing.push(`Missing section: ${section.name}`);
    }
  }
  return missing;
}

interface FieldRequirement {
  readonly label: string;
  readonly aliases: readonly string[];
}

/**
 * Trailing boundary for heading patterns. JS `\b` only recognizes ASCII word
 * characters, which breaks Korean headings (e.g. `## 평가 계획` at end of
 * line). This negative lookahead works for both scripts under the `u` flag.
 */
const UNICODE_WORD_BOUNDARY = '(?![\\p{L}\\p{N}_])';

const WORK_GRAPH_HEADING_ALIASES = ['WorkGraph', '워크그래프', '워크 그래프'] as const;

const ALL_ULTRA_PLAN_FIELD_LABELS = [
  'Seed Spec',
  'AC Tree',
  'WorkGraph',
  'WorkGraph Nodes',
  'Node ID',
  'AC ID',
  'Stage',
  'Owner',
  'Lane',
  'Dependencies',
  'Required Evidence',
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
  // Korean aliases — the response language lock may localize plan headings.
  '시드 사양',
  '시드 스펙',
  'AC 트리',
  'AC트리',
  '인수 기준 트리',
  '워크그래프',
  '워크 그래프',
  '평가 계획',
  '실행 계획',
  '스웜 결정',
  '검증 가능한 목표',
  '검증 가능 목표',
  '완료 기준',
  '참여자',
  '액터',
  '입력',
  '출력',
  '산출물',
  '제약',
  '제약 조건',
  '비목표',
  '비-목표',
  '인수 기준',
  '수용 기준',
  '검증 계획',
  '실패 모드',
  '런타임 컨텍스트',
];

function missingWorkGraphRequirements(plan: string): string[] {
  const section = WORK_GRAPH_HEADING_ALIASES.map((alias) => headingSection(plan, alias)).find(
    (text) => text.length > 0,
  );
  if (section === undefined) return [];
  const requirements: readonly { readonly label: string; readonly pattern: RegExp }[] = [
    {
      label: 'WorkGraph node id',
      pattern: workGraphFieldPattern('node\\s*id|node|id|노드\\s*id|노드'),
    },
    {
      label: 'WorkGraph AC id',
      pattern: workGraphFieldPattern(
        'ac(?:\\s*id)?|acceptance\\s+criterion(?:\\s+id)?|acceptanceCriterionId|인수\\s*기준(?:\\s*id)?',
      ),
    },
    { label: 'WorkGraph stage', pattern: workGraphFieldPattern('stage|단계') },
    {
      label: 'WorkGraph owner/lane',
      pattern: workGraphFieldPattern('owner|lane|owner\\s*/\\s*lane|소유자|담당'),
    },
    {
      label: 'WorkGraph dependencies',
      pattern: workGraphFieldPattern('dependencies|dependency|dependsOn|depends\\s+on|의존|의존성'),
    },
    {
      label: 'WorkGraph required evidence',
      pattern: workGraphFieldPattern(
        'required\\s+evidence|requiredEvidence|required_evidence|evidence\\s+required|필요\\s*증거|요구\\s*증거|필수\\s*증거',
      ),
    },
  ];
  return requirements
    .filter((requirement) => !requirement.pattern.test(section))
    .map((requirement) => requirement.label);
}

/**
 * Unicode-aware word boundary for alternations that may contain Korean
 * labels: JS `\b` only sees ASCII word characters, so Korean alternatives
 * would never match at a `\b` edge.
 */
function workGraphFieldPattern(alternation: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`,
    'iu',
  );
}

function headingSection(plan: string, heading: string): string {
  const lines = plan.split(/\r?\n/);
  const headingPattern = new RegExp(
    `^\\s*#{2,}\\s+${escapeRegExp(heading)}${UNICODE_WORD_BOUNDARY}`,
    'iu',
  );
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    if (headingPattern.test(lines[index] ?? '')) {
      start = index + 1;
      break;
    }
  }
  if (start === -1) return '';
  const section: string[] = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (/^\s*#{2,}\s+\S/.test(line)) break;
    section.push(line);
  }
  return section.join('\n');
}

function hasHeading(plan: string, heading: string): boolean {
  return new RegExp(`^\\s*#{2,}\\s+${escapeRegExp(heading)}${UNICODE_WORD_BOUNDARY}`, 'imu').test(
    plan,
  );
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
  return /\bswarm decision\s*:\s*(?:ENGAGE|ADAPTIVE|DEFER)\b/i.test(plan);
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
      return /\bswarm decision\s*:\s*(?:ENGAGE|ADAPTIVE|DEFER)\b/i.test(plan);
    case 'Reason':
      return /\bswarm decision\s*:\s*(?:ENGAGE|ADAPTIVE|DEFER)\s*(?:[.:\-—]\s*\S|.*\breason\s*:)/i.test(plan);
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
  return new RegExp(
    `^\\s*#{2,}\\s+(?:${labelAlternation})${UNICODE_WORD_BOUNDARY}`,
    'iu',
  );
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

function formatPlanForOutput(
  plan: string,
  path: string | undefined,
  ultraDrift: UltraPlanDriftResult | undefined,
  seededWorkGraph: ReturnType<typeof seedUltraworkGraphFromApprovedPlan>,
): string {
  const savedTo = path !== undefined ? `Plan saved to: ${path}\n\n` : '';
  let output = `Plan mode deactivated. All tools are now available.\n${savedTo}## Approved Plan:\n${plan}`;

  if (ultraDrift !== undefined && ultraDrift.ok === true) {
    if (ultraDrift.warning !== undefined) {
      output += `\n\n---\n## Warning\n${ultraDrift.warning}`;
    }
    const seededNotice = formatSeededWorkGraphNotice(seededWorkGraph);
    if (seededNotice !== undefined) {
      output += `\n\n---\n## UltraworkGraph Seed\n${seededNotice}`;
    }
    const nextAction = ultraSwarmEngageNextAction(plan, seededWorkGraph);
    if (nextAction !== undefined) {
      output += `\n\n---\n## Required Next Action\n${nextAction}`;
    }
    output += `\n\n---\n${formatUltraPlanMetrics(ultraDrift.metrics)}`;
  }

  return output;
}

function swarmDecisionSummary(plan: string): string | undefined {
  const line = plan.split(/\r?\n/).find((entry) => /\bswarm decision\s*:/i.test(entry));
  const trimmed = line?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function formatUltraPlanMetrics(metrics: DriftMetrics): string {
  const combined = combinedDrift(metrics);
  let output = '## Ultra Plan Metrics\n';
  output += `- Goal Drift: ${metrics.goalDrift.toFixed(3)}\n`;
  output += `- Constraint Drift: ${metrics.constraintDrift.toFixed(3)}\n`;
  output += `- Ontology Drift: ${metrics.ontologyDrift.toFixed(3)}\n`;
  output += `- Combined Drift: ${combined.toFixed(3)} (threshold: ${ULTRA_PLAN_DRIFT_THRESHOLD})\n`;
  output += `- Status: ${isDriftAcceptable(metrics) ? 'ACCEPTABLE' : 'BLOCKED — plan may deviate from seed spec'}\n`;
  return output;
}
