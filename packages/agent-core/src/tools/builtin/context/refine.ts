/**
 * RefineTool — lets the model run the harness refine pipeline itself
 * (Prime Agent's `/refine` equivalent): review the recent trajectory, apply
 * small harness edits (prompt notes, memory records, skills, subagent
 * specs) with before/after snapshots, and roll them back by id.
 */

import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './refine.md?raw';

export const RefineToolInputSchema = z
  .object({
    action: z
      .enum(['run', 'status', 'rollback'])
      .default('run')
      .describe('run: review the trajectory and apply harness edits. status: list current harness entries and recent refinements. rollback: revert one applied refinement.'),
    scope: z
      .enum(['local', 'global'])
      .default('local')
      .describe('local: this session/workspace. global: reusable across sessions (only for generalizable improvements).'),
    instructions: z
      .string()
      .optional()
      .describe(
        'What to focus the refinement on (e.g. "capture the flaky-test retry pattern"). When writing skills, require a checkable completion criterion and prefer positive target behaviour over negation lists (writing-for-agents).',
      ),
    refinementId: z
      .string()
      .optional()
      .describe('Target refinement id for action=rollback (from a run result or status listing).'),
  })
  .strict();

export type RefineToolInput = z.infer<typeof RefineToolInputSchema>;

const STATUS_LIST_MAX_EVENTS = 10;

export class RefineTool implements BuiltinTool<RefineToolInput> {
  readonly name = 'Refine' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RefineToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: RefineToolInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description:
        args.action === 'status'
          ? 'Reading harness state'
          : args.action === 'rollback'
            ? `Rolling back refinement ${args.refinementId ?? ''}`
            : 'Refining the harness',
      approvalRule: this.name,
      execute: async () => {
        const refine = this.agent.refine;
        if (refine === null) {
          return { output: 'Refine is only available on the main agent.' };
        }
        switch (args.action) {
          case 'status':
            return { output: renderStatus(this.agent) };
          case 'rollback':
            return { output: await runRollback(this.agent, args.refinementId) };
          case 'run':
            return { output: await runRefine(this.agent, args) };
        }
      },
    };
  }
}

async function runRefine(agent: Agent, args: RefineToolInput): Promise<string> {
  const refine = agent.refine!;
  try {
    const result = await refine.refine({
      scope: args.scope,
      ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
    });
    const lines = [`Refine (${result.scope}): ${result.summary}`];
    if (result.applied.length === 0 && result.failed.length === 0) {
      lines.push('No edits proposed — the trajectory showed nothing worth persisting.');
    }
    for (const event of result.applied) {
      lines.push(
        `applied ${event.id}: ${event.kind} ${event.targetId} — ${truncate(event.summary, 120)}`,
      );
    }
    for (const event of result.failed) {
      lines.push(`FAILED ${event.kind} ${event.targetId}: ${event.error ?? 'unknown error'}`);
    }
    if (result.applied.length > 0) {
      lines.push('Roll back any edit with Refine(action=rollback, refinementId=<id>).');
    }
    return lines.join('\n');
  } catch (error) {
    return `Refine failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runRollback(agent: Agent, refinementId: string | undefined): Promise<string> {
  if (refinementId === undefined || refinementId.trim().length === 0) {
    return 'rollback requires refinementId (see Refine(action=status) for ids).';
  }
  try {
    const event = await agent.refine!.rollback(refinementId.trim());
    return `Rolled back ${event.id}: ${event.kind} ${event.targetId}.`;
  } catch (error) {
    return `Rollback failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderStatus(agent: Agent): string {
  const refine = agent.refine!;
  const state = refine.state();
  const snapshot = refine.snapshot();
  const lines = [
    `Harness entries: ${String(snapshot.promptNotes)} prompt notes, ${String(snapshot.subagentSpecs)} subagent specs.`,
    `Refinements recorded: ${String(snapshot.refinements)} (last run ${snapshot.lastRefinedAt === null ? 'never' : new Date(snapshot.lastRefinedAt).toISOString()}).`,
  ];
  for (const entry of state.entries) {
    lines.push(
      `entry ${entry.id}: ${entry.kind} "${entry.title}" (${entry.scope}, v${String(entry.version)})`,
    );
  }
  const recent = state.refinements.slice(-STATUS_LIST_MAX_EVENTS);
  for (const event of recent) {
    lines.push(
      `refinement ${event.id}: ${event.kind} ${event.targetId} [${event.status}] — ${truncate(event.summary, 100)}`,
    );
  }
  if (state.entries.length === 0 && state.refinements.length === 0) {
    lines.push('Nothing yet — Refine(action=run) reviews the trajectory and proposes edits.');
  }
  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  const flat = text.replaceAll('\n', ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
