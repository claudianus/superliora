import { z } from 'zod';

import type { SwarmMode } from '../../../agent/swarm';
import type { BuiltinTool } from '../../../agent/tool';
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type QueuedSubagentTask,
  type SessionSubagentHost,
} from '../../../session/subagent-host';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import ULTRA_SWARM_DESCRIPTION from './ultra-swarm.md?raw';
import { toInputJsonSchema } from '../../support/input-schema';
import { globalUltraSwarmOrchestrator } from '../../../expert-agents/orchestrator';
import type { ExpertAssignment, ExpertSwarmPlan } from '../../../expert-agents/types';

const MAX_ULTRA_SWARM_SUBAGENTS = 128;

export const UltraSwarmToolInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1)
      .describe('Task description for the UltraSwarm. Be specific about what you need.'),
    experts: z
      .array(z.string().trim().min(1))
      .max(MAX_ULTRA_SWARM_SUBAGENTS)
      .optional()
      .describe(
        'Optional list of expert IDs to summon. If omitted, the system will auto-select the best experts for the task.',
      ),
    required_experts: z
      .array(z.string().trim().min(1))
      .max(MAX_ULTRA_SWARM_SUBAGENTS)
      .optional()
      .describe(
        'Expert IDs that must be included even when auto_select is true. Useful when Ultrawork has already identified mandatory research, review, or verification roles.',
      ),
    max_experts: z
      .number()
      .int()
      .min(1)
      .max(MAX_ULTRA_SWARM_SUBAGENTS)
      .optional()
      .describe('Maximum experts to launch. Defaults to 24 and never exceeds 128.'),
    intensity: z
      .enum(['balanced', 'premium', 'max'])
      .optional()
      .describe(
        'Swarm staffing intensity. balanced keeps staffing conservative, premium uses the default enterprise team, max allows the largest team up to max_experts.',
      ),
    focus: z
      .enum(['plan', 'research', 'implement', 'review', 'full'])
      .optional()
      .describe(
        'Primary swarm focus. Ultrawork uses this to distinguish planning, research, implementation, review, or full lifecycle work.',
      ),
    auto_select: z
      .boolean()
      .optional()
      .describe(
        'When true (default), the system automatically selects experts based on the task description. Set to false to require explicit expert IDs.',
      ),
    subagent_type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Base execution profile for spawned experts. Each expert still runs as its own expert subagent. Defaults to "coder" when omitted.',
      ),
    run_in_background: z
      .boolean()
      .optional()
      .describe(
        'If true, return immediately without waiting for completion. Prefer false unless the task can run independently.',
      ),
  })
  .strict();

export type UltraSwarmToolInput = z.infer<typeof UltraSwarmToolInputSchema>;

interface UltraSwarmSpec {
  readonly index: number;
  readonly expertId: string;
  readonly expertName: string;
  readonly prompt: string;
  readonly emoji: string;
  readonly color: string;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
}

interface UltraSwarmRunResult {
  readonly spec: UltraSwarmSpec;
  readonly agentId?: string;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly state?: 'started' | 'not_started';
  readonly result?: string;
  readonly error?: string;
}

export class UltraSwarmTool implements BuiltinTool<UltraSwarmToolInput> {
  readonly name = 'UltraSwarm' as const;
  readonly description = ULTRA_SWARM_DESCRIPTION + `

 — Summon a team of expert agents to tackle complex tasks collaboratively.

This tool automatically assembles and orchestrates a swarm of specialized expert agents based on your task description. Each expert is selected from a catalog of 217+ professionals across 16 domains (Engineering, Design, Security, Product, Marketing, etc.) and given their specific persona to ensure high-quality, domain-specific output.

## How it works
1. Analyze your task description to identify required expertise domains
2. Search the expert catalog using BM25+fuzzy text search to find the best matches
3. Spawn each expert as a subagent with their full persona injected
4. Execute all experts in parallel (or sequential if dependencies exist)
5. Collect and synthesize results

## Usage tips
- Be specific in your description for better expert matching
- You can explicitly request experts by ID, or let the system auto-select
- Each expert receives their full persona + your task description
- Each call can launch up to 128 expert subagents; cap active concurrency with KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY when needed
- Results are tagged with expert name and emoji for easy identification

## Available divisions
Engineering, Design, Security, Product, Marketing, Testing, Academic, Finance, Game Development, GIS, Paid Media, Project Management, Sales, Spatial Computing, Specialized, Support`;

  readonly parameters: Record<string, unknown> = toInputJsonSchema(UltraSwarmToolInputSchema);

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly swarmMode: SwarmMode,
  ) {}

  resolveExecution(args: UltraSwarmToolInput): ToolExecution {
    const expertCount = args.experts?.length ?? 'auto';
    return {
      accesses: ToolAccesses.all(),
      description: `UltraSwarm: ${args.description}`,
      display: {
        kind: 'agent_call',
        agent_name: `UltraSwarm (${expertCount} experts)`,
        prompt: args.description,
      },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: UltraSwarmToolInput,
    context: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      this.swarmMode.enter('tool');
      const result = await this.runUltraSwarm(args, context.signal, context.toolCallId);
      return { output: result };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  private async runUltraSwarm(
    args: UltraSwarmToolInput,
    signal: AbortSignal,
    toolCallId: string,
  ): Promise<string> {
    const profileBaseName = normalizeOptionalString(args.subagent_type) ?? 'coder';
    const autoSelect = args.auto_select !== false;
    const maxExperts = args.max_experts ?? defaultMaxExperts(args.intensity);
    const requestedExperts = uniqueStrings([
      ...(autoSelect ? [] : (args.experts ?? [])),
      ...(args.required_experts ?? []),
    ]);
    if (requestedExperts.length > maxExperts) {
      throw new Error(
        `UltraSwarm max_experts is ${String(maxExperts)}, but ${String(requestedExperts.length)} explicit/required experts were requested.`,
      );
    }

    // Build the swarm plan
    const plan = await this.buildPlan(args.description, autoSelect, requestedExperts, maxExperts);

    if (plan.experts.length === 0) {
      return 'No matching experts found for this task. Try being more specific in your description.';
    }

    if (plan.experts.length > MAX_ULTRA_SWARM_SUBAGENTS) {
      throw new Error(
        `UltraSwarm supports at most ${String(MAX_ULTRA_SWARM_SUBAGENTS)} experts. Requested: ${String(plan.experts.length)}`,
      );
    }

    // Build specs from plan
    const specs: UltraSwarmSpec[] = plan.experts.map((assignment, index) => ({
      index: index + 1,
      expertId: assignment.expertId,
      expertName: assignment.expertName,
      prompt: this.buildExpertPrompt(assignment, args.description, args.focus),
      emoji: assignment.emoji,
      color: assignment.color,
      coverageLane: assignment.coverageLane,
      selectionReason: assignment.selectionReason,
    }));

    const tasks = specs.map((spec): QueuedSubagentTask<UltraSwarmSpec> => ({
      kind: 'spawn',
      data: spec,
      profileName: spec.expertId,
      profileBaseName,
      parentToolCallId: toolCallId,
      prompt: spec.prompt,
      description: `${args.description} #${String(spec.index)} (${spec.expertName} ${spec.emoji})`,
      swarmIndex: spec.index,
      runInBackground: args.run_in_background === true,
      swarmItem: spec.expertId,
      signal,
      timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
    }));

    const results = await this.subagentHost.runQueued(tasks);
    return renderUltraSwarmResults(
      results.map(({ task, ...result }) => ({ spec: task.data, ...result })),
      plan,
    );
  }

  private async buildPlan(
    description: string,
    autoSelect: boolean,
    requestedExperts: readonly string[],
    maxExperts: number,
  ): Promise<ExpertSwarmPlan> {
    const base = await globalUltraSwarmOrchestrator.buildSwarmPlan(
      description,
      autoSelect ? undefined : requestedExperts,
    );
    if (autoSelect && requestedExperts.length > 0) {
      const required = await globalUltraSwarmOrchestrator.buildSwarmPlan(description, requestedExperts);
      return capPlan(mergePlans(required, base), maxExperts);
    }
    return capPlan(base, maxExperts);
  }

  private buildExpertPrompt(
    assignment: ExpertAssignment,
    taskDescription: string,
    focus: UltraSwarmToolInput['focus'],
  ): string {
    const briefing = `<expert_briefing name="${assignment.expertName}" emoji="${assignment.emoji}" color="${assignment.color}">
${assignment.prompt}
</expert_briefing>`;
    const task = `<task>
${taskDescription}
</task>`;
    const laneLine = assignment.coverageLane === undefined ? '' : `\nCoverage lane: ${assignment.coverageLane}.`;
    const reasonLine = assignment.selectionReason === undefined
      ? ''
      : `\nSelection reason: ${assignment.selectionReason}`;
    const focusLine = focus === undefined ? '' : `\nFocus lane: ${focus}.`;
    const reviewLine =
      focus === 'review' || focus === 'full'
        ? '\nReview gate: compare actual evidence against the assigned acceptance criteria. Return PASS only when evidence is sufficient; otherwise return concrete fixes and the evidence still missing.'
        : '';
    return `${briefing}\n\n${task}${laneLine}${reasonLine}${focusLine}${reviewLine}\n\nApply your ${assignment.expertName} expertise to this task. Provide a thorough, high-quality response that leverages your specialized knowledge and skills.`;
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultMaxExperts(intensity: UltraSwarmToolInput['intensity']): number {
  if (intensity === 'max') return MAX_ULTRA_SWARM_SUBAGENTS;
  return 24;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function mergePlans(primary: ExpertSwarmPlan, secondary: ExpertSwarmPlan): ExpertSwarmPlan {
  const seen = new Set<string>();
  const experts: ExpertAssignment[] = [];
  for (const assignment of [...primary.experts, ...secondary.experts]) {
    if (seen.has(assignment.expertId)) continue;
    seen.add(assignment.expertId);
    experts.push(assignment);
  }
  return {
    taskDescription: secondary.taskDescription,
    strategy: experts.length > 3 ? 'mixed' : experts.length > 1 ? 'parallel' : 'sequential',
    experts,
  };
}

function capPlan(plan: ExpertSwarmPlan, maxExperts: number): ExpertSwarmPlan {
  if (plan.experts.length <= maxExperts) return plan;
  return {
    ...plan,
    experts: plan.experts.slice(0, maxExperts),
    strategy: maxExperts > 3 ? 'mixed' : maxExperts > 1 ? 'parallel' : 'sequential',
  };
}

function renderUltraSwarmResults(
  results: readonly UltraSwarmRunResult[],
  plan: { readonly taskDescription: string; readonly strategy: string },
): string {
  const completed = results.filter((r) => r.status === 'completed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const aborted = results.filter((r) => r.status === 'aborted').length;

  const lines = [
    '<ultra_swarm_result>',
    `<task>${escapeXml(plan.taskDescription)}</task>`,
    `<strategy>${plan.strategy}</strategy>`,
    `<summary>completed: ${String(completed)}, failed: ${String(failed)}, aborted: ${String(aborted)}</summary>`,
    '<coverage>Each expert row includes the assigned coverage lane and selection reason for auditability.</coverage>',
  ];

  for (const result of results) {
    const agentId = result.agentId === undefined ? '' : ` agent_id="${result.agentId}"`;
    const state = result.state === undefined ? '' : ` state="${result.state}"`;
    const lane = result.spec.coverageLane === undefined
      ? ''
      : ` lane="${escapeXml(result.spec.coverageLane)}"`;
    const body =
      result.status === 'completed'
        ? (result.result ?? '')
        : (result.error ?? 'unknown error');
    const selectionReason = result.spec.selectionReason === undefined
      ? ''
      : `<selection_reason>${escapeXml(result.spec.selectionReason)}</selection_reason>\n`;
    lines.push(
      `<expert name="${escapeXml(result.spec.expertName)}" emoji="${escapeXml(result.spec.emoji)}" color="${escapeXml(result.spec.color)}" outcome="${result.status}"${agentId}${state}${lane}>\n${selectionReason}${body}\n</expert>`,
    );
  }

  lines.push('</ultra_swarm_result>');
  return lines.join('\n');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
