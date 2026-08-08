/**
 * CompactTool — lets the model trigger full compaction itself (Prime Agent's
 * `compact.run()` equivalent) or inspect how close the context is to the
 * compaction threshold (`compact.status()` equivalent). Manual RPC compaction
 * rejects mid-turn, so the run action goes through the `agent` source and
 * awaits apply so the next tool batch sees the reduced context.
 */

import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './compact.md?raw';

export const CompactToolInputSchema = z
  .object({
    action: z
      .enum(['run', 'status'])
      .default('run')
      .describe(
        'run: compact now and wait until the summary is applied. status: report current context usage vs the compaction threshold (includes pendingApply while a run is in flight).',
      ),
    instruction: z
      .string()
      .optional()
      .describe('What the summary must preserve (e.g. "keep the failing test names and the fix plan").'),
  })
  .strict();

export type CompactToolInput = z.infer<typeof CompactToolInputSchema>;

export class CompactTool implements BuiltinTool<CompactToolInput> {
  readonly name = 'Compact' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(CompactToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: CompactToolInput): ToolExecution {
    const compaction = this.agent.fullCompaction;
    return {
      accesses: ToolAccesses.all(),
      description: args.action === 'status' ? 'Reading compaction status' : 'Compacting conversation history',
      approvalRule: this.name,
      execute: async () => {
        if (args.action === 'status') {
          return { output: this.statusOutput() };
        }
        if (compaction.isCompacting) {
          return {
            output: [
              'Compaction is already in progress (pendingApply=yes).',
              'Awaiting the in-flight run…',
              await this.awaitAndReport(),
            ].join('\n'),
          };
        }
        const before = this.agent.context.tokenCountWithPending;
        compaction.begin({ source: 'agent', instruction: args.instruction });
        if (!compaction.isCompacting) {
          return {
            output:
              'Nothing to compact right now — the current history has no compactable prefix. Try again after more turns.',
          };
        }
        return { output: await this.awaitAndReport(before) };
      },
    };
  }

  private statusOutput(): string {
    const compaction = this.agent.fullCompaction;
    const used = this.agent.context.tokenCountWithPending;
    const max = compaction.getEffectiveMaxContextTokens();
    const percent = max > 0 ? Math.round((used / max) * 100) : 0;
    const compactedBefore = this.agent.context.history.some(
      (message) => message.origin?.kind === 'compaction_summary',
    );
    const pendingApply = compaction.isCompacting;
    return [
      `Context tokens: ${String(used)} / ${String(max)} (${String(percent)}%).`,
      `Compaction in progress: ${pendingApply ? 'yes' : 'no'}.`,
      `pendingApply: ${pendingApply ? 'yes' : 'no'}.`,
      `Compacted before: ${compactedBefore ? 'yes' : 'no'}.`,
      pendingApply
        ? 'A compaction run is applying — wait or call Compact(action=run) again to await it.'
        : 'Call Compact(action=run) when the current phase no longer needs earlier detail; it waits until the summary is applied.',
    ].join('\n');
  }

  private async awaitAndReport(tokensBefore?: number): Promise<string> {
    const compaction = this.agent.fullCompaction;
    const before = tokensBefore ?? this.agent.context.tokenCountWithPending;
    await compaction.waitUntilSettled();
    const after = this.agent.context.tokenCountWithPending;
    const max = compaction.getEffectiveMaxContextTokens();
    const percent = max > 0 ? Math.round((after / max) * 100) : 0;
    const delta = before - after;
    const deltaLine =
      delta > 0
        ? `Reclaimed ~${String(delta)} tokens (${String(before)} → ${String(after)}).`
        : `Context now ${String(after)} tokens (no net reclaim — summary may have been large).`;
    return [
      'Compaction applied (pendingApply=no).',
      deltaLine,
      `Context tokens: ${String(after)} / ${String(max)} (${String(percent)}%).`,
      'Recent messages stay intact; archived tool results remain recoverable via Expand.',
    ].join('\n');
  }
}
