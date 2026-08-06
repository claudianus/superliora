/**
 * Subagent friction report: deterministic struggle stats appended to the
 * completion envelope. The parent already refines over its own trajectory —
 * this is how the worker's evidence (which tools failed, how often) reaches
 * that pipeline without giving every ephemeral worker write access to the
 * shared harness state.
 */

import type { ContextMessage } from '../../agent/context/types';

export interface SubagentFriction {
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly topErrorTools: readonly string[];
}

const MAX_ERROR_TOOLS = 3;

// ponytail: computed from the surviving history at completion — mid-run
// compactions drop earlier tool results, so long runs undercount errors.
// Upgrade path: increment counters off the child's tool.result event stream.
export function computeSubagentFriction(history: readonly ContextMessage[]): SubagentFriction {
  const toolNames = new Map<string, string>();
  let turns = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  const errorCounts = new Map<string, number>();
  for (const message of history) {
    if (message.role === 'assistant') {
      turns += 1;
      for (const call of message.toolCalls) {
        toolCalls += 1;
        toolNames.set(call.id, call.name);
      }
      continue;
    }
    if (message.role === 'tool' && message.isError === true) {
      toolErrors += 1;
      const name =
        (message.toolCallId !== undefined ? toolNames.get(message.toolCallId) : undefined) ??
        'unknown';
      errorCounts.set(name, (errorCounts.get(name) ?? 0) + 1);
    }
  }
  const topErrorTools = [...errorCounts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, MAX_ERROR_TOOLS)
    .map(([name, count]) => `${name}×${String(count)}`);
  return { turns, toolCalls, toolErrors, topErrorTools };
}

/** One compact block for the completion envelope; undefined for clean runs. */
export function renderFrictionSection(friction: SubagentFriction): string | undefined {
  if (friction.toolErrors === 0) return undefined;
  const tools =
    friction.topErrorTools.length > 0 ? ` (${friction.topErrorTools.join(', ')})` : '';
  return [
    '[friction]',
    `turns: ${String(friction.turns)}, tool_calls: ${String(friction.toolCalls)}, tool_errors: ${String(friction.toolErrors)}${tools}`,
    'If the same error recurs across agents, capture the lesson with the Refine tool.',
  ].join('\n');
}
