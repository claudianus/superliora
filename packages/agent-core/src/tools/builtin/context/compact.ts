/**
 * CompactTool — lets the model trigger full compaction itself (Prime Agent's
 * `compact.run()` equivalent) or inspect how close the context is to the
 * compaction threshold (`compact.status()` equivalent). Manual RPC compaction
 * rejects mid-turn, so the run action goes through the `agent` source, which
 * runs the worker in background mode alongside the live turn — the same path
 * async background compaction already uses.
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
      .describe('run: start background compaction. status: report current context usage vs the compaction threshold.'),
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
          const used = this.agent.context.tokenCountWithPending;
          const max = compaction.getEffectiveMaxContextTokens();
          const percent = max > 0 ? Math.round((used / max) * 100) : 0;
          const compactedBefore = this.agent.context.history.some(
            (message) => message.origin?.kind === 'compaction_summary',
          );
          return {
            output: [
              `Context tokens: ${String(used)} / ${String(max)} (${String(percent)}%).`,
              `Compaction in progress: ${compaction.isCompacting ? 'yes' : 'no'}.`,
              `Compacted before: ${compactedBefore ? 'yes' : 'no'}.`,
              compaction.isCompacting
                ? 'A background compaction is already running; its summary lands at a turn boundary.'
                : 'Call Compact(action=run) when the current phase no longer needs earlier detail.',
            ].join('\n'),
          };
        }
        if (compaction.isCompacting) {
          return { output: 'Compaction is already in progress; no new run started.' };
        }
        compaction.begin({ source: 'agent', instruction: args.instruction });
        if (!compaction.isCompacting) {
          return {
            output:
              'Nothing to compact right now — the current history has no compactable prefix. Try again after more turns.',
          };
        }
        return {
          output:
            'Compaction started in the background. Older history will be summarized; recent messages stay intact and archived tool results remain recoverable via Expand. You can keep working.',
        };
      },
    };
  }
}
