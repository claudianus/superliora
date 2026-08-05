import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_RECOVER_TOOL,
  isSwarmToolName,
  maskStaleSwarmToolResults,
  resolveArchiveRecoverToolName,
} from '#/agent/compaction/micro/micro-helpers';
import type { ContextMessage } from '#/agent/context';

describe('resolveArchiveRecoverToolName', () => {
  it('uses the single Expand recovery tool', () => {
    expect(resolveArchiveRecoverToolName(['Read', 'Expand'])).toBe(ARCHIVE_RECOVER_TOOL);
    expect(resolveArchiveRecoverToolName(['Read', 'Grep'])).toBe(ARCHIVE_RECOVER_TOOL);
  });
});

describe('isSwarmToolName', () => {
  it('recognizes the swarm tool family and nothing else', () => {
    expect(isSwarmToolName('UltraSwarm')).toBe(true);
    expect(isSwarmToolName('AgentSwarm')).toBe(true);
    expect(isSwarmToolName('Fleet')).toBe(true);
    expect(isSwarmToolName('Read')).toBe(false);
    expect(isSwarmToolName(undefined)).toBe(false);
  });
});

describe('maskStaleSwarmToolResults', () => {
  const swarmXml = (body: string): string =>
    `<agent_swarm_result>\n<subagent name="a">${body}</subagent>\n</agent_swarm_result>`;

  const assistantCall = (id: string, name: string): ContextMessage =>
    ({
      role: 'assistant',
      content: [],
      toolCalls: [{ type: 'function', id, name, arguments: null }],
    }) as ContextMessage;

  const toolResult = (id: string, text: string): ContextMessage =>
    ({
      role: 'tool',
      toolCallId: id,
      content: [{ type: 'text', text }],
    }) as ContextMessage;

  const textOf = (message: ContextMessage): string =>
    message.content
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n');

  it('masks every swarm result except the newest one', () => {
    const history: ContextMessage[] = [
      assistantCall('call-1', 'AgentSwarm'),
      toolResult('call-1', swarmXml('first\nrun body')),
      assistantCall('call-2', 'AgentSwarm'),
      toolResult('call-2', swarmXml('second\nrun body')),
    ];
    const masked = maskStaleSwarmToolResults([history]);
    expect(masked).toBe(1);
    // Oldest result collapsed (whitespace folded by the handoff collapse).
    expect(textOf(history[1]!)).not.toContain('first\nrun body');
    expect(textOf(history[1]!)).toContain('first run body');
    // Newest result stays byte-identical.
    expect(textOf(history[3]!)).toBe(swarmXml('second\nrun body'));
  });

  it('leaves non-swarm tool results and plain results untouched', () => {
    const history: ContextMessage[] = [
      assistantCall('call-r', 'Read'),
      toolResult('call-r', 'file\ncontents'),
      assistantCall('call-s', 'AgentSwarm'),
      toolResult('call-s', swarmXml('only\nswarm')),
    ];
    const before = history.map((message) => textOf(message));
    expect(maskStaleSwarmToolResults([history])).toBe(0);
    expect(history.map((message) => textOf(message))).toEqual(before);
  });

  it('treats segments in projection order: newest in the deferred tail protects history', () => {
    const history: ContextMessage[] = [
      assistantCall('call-1', 'UltraSwarm'),
      toolResult('call-1', swarmXml('old\nbody')),
    ];
    const deferred: ContextMessage[] = [
      assistantCall('call-2', 'Fleet'),
      toolResult('call-2', swarmXml('new\nbody')),
    ];
    expect(maskStaleSwarmToolResults([history, deferred])).toBe(1);
    expect(textOf(history[1]!)).toContain('old body');
    expect(textOf(deferred[1]!)).toBe(swarmXml('new\nbody'));
  });

  it('masks already-stored results when a late-arriving swarm result lands', () => {
    // Append-time rule mirrors the legacy lazy mask: the newest swarm result
    // in projection order survives. A late-arriving result lands at the tail,
    // so its arrival masks every earlier stored swarm result exactly once.
    const history: ContextMessage[] = [
      assistantCall('call-first', 'AgentSwarm'),
      toolResult('call-first', swarmXml('stored\nbody')),
    ];
    history.push(assistantCall('call-late', 'AgentSwarm'));
    history.push(toolResult('call-late', swarmXml('late\nbody')));
    expect(maskStaleSwarmToolResults([history])).toBe(1);
    expect(textOf(history[1]!)).toContain('stored body');
    expect(textOf(history[1]!)).not.toContain('stored\nbody');
    expect(textOf(history[3]!)).toBe(swarmXml('late\nbody'));
  });

  it('is idempotent once results are masked', () => {
    const history: ContextMessage[] = [
      assistantCall('call-1', 'AgentSwarm'),
      toolResult('call-1', swarmXml('first\nbody')),
      assistantCall('call-2', 'AgentSwarm'),
      toolResult('call-2', swarmXml('second\nbody')),
    ];
    expect(maskStaleSwarmToolResults([history])).toBe(1);
    expect(maskStaleSwarmToolResults([history])).toBe(0);
  });
});
