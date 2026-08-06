import { describe, expect, it } from 'vitest';

import type { ContextMessage } from '../../src/agent/context/types';
import {
  computeSubagentFriction,
  renderFrictionSection,
} from '../../src/session/subagent/subagent-friction';
import { renderSubagentCompletionText } from '../../src/session/subagent/subagent-result-contract';

function assistantWithCalls(...calls: Array<{ id: string; name: string }>): ContextMessage {
  return {
    role: 'assistant',
    content: [],
    toolCalls: calls.map((call) => ({
      type: 'function' as const,
      id: call.id,
      name: call.name,
      arguments: '{}',
    })),
  };
}

function toolResult(toolCallId: string, isError: boolean): ContextMessage {
  return {
    role: 'tool',
    content: [{ type: 'text', text: isError ? 'boom' : 'ok' }],
    toolCalls: [],
    toolCallId,
    isError,
  };
}

describe('computeSubagentFriction', () => {
  it('counts turns, tool calls, and errors grouped by tool name', () => {
    const history: ContextMessage[] = [
      assistantWithCalls({ id: 'c1', name: 'Bash' }, { id: 'c2', name: 'Edit' }),
      toolResult('c1', true),
      toolResult('c2', false),
      assistantWithCalls({ id: 'c3', name: 'Bash' }),
      toolResult('c3', true),
    ];

    const friction = computeSubagentFriction(history);

    expect(friction.turns).toBe(2);
    expect(friction.toolCalls).toBe(3);
    expect(friction.toolErrors).toBe(2);
    expect(friction.topErrorTools).toEqual(['Bash×2']);
  });

  it('reports zero errors for a clean run', () => {
    const history: ContextMessage[] = [
      assistantWithCalls({ id: 'c1', name: 'Read' }),
      toolResult('c1', false),
    ];

    const friction = computeSubagentFriction(history);

    expect(friction.toolErrors).toBe(0);
    expect(friction.topErrorTools).toEqual([]);
  });
});

describe('renderFrictionSection', () => {
  it('renders nothing for a clean run', () => {
    expect(
      renderFrictionSection({ turns: 3, toolCalls: 5, toolErrors: 0, topErrorTools: [] }),
    ).toBeUndefined();
  });

  it('renders a compact block when errors occurred', () => {
    const section = renderFrictionSection({
      turns: 12,
      toolCalls: 34,
      toolErrors: 5,
      topErrorTools: ['Bash×3', 'Edit×2'],
    });

    expect(section).toContain('[friction]');
    expect(section).toContain('tool_errors: 5');
    expect(section).toContain('Bash×3');
  });
});

describe('renderSubagentCompletionText', () => {
  it('appends the friction block after the summary', () => {
    const text = renderSubagentCompletionText({
      result: 'done the thing',
      friction: { turns: 4, toolCalls: 9, toolErrors: 2, topErrorTools: ['Bash×2'] },
    });

    expect(text).toContain('done the thing');
    expect(text).toContain('[friction]');
    expect(text.indexOf('done the thing')).toBeLessThan(text.indexOf('[friction]'));
  });

  it('omits the friction block for clean runs', () => {
    const text = renderSubagentCompletionText({
      result: 'clean',
      friction: { turns: 1, toolCalls: 1, toolErrors: 0, topErrorTools: [] },
    });

    expect(text).toBe('clean');
  });
});
