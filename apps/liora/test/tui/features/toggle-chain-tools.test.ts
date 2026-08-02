import { describe, expect, it } from 'vitest';

import { AgentGroupComponent } from '#/tui/components/messages/agent-group';
import { AssistantMessageComponent } from '#/tui/components/messages/assistant-message';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { ToolChainSummaryComponent } from '#/tui/components/messages/tool-chain-summary';
import { UserMessageComponent } from '#/tui/components/messages/user-message';
import {
  collectToolsAfterChain,
  isChainToggleableTool,
  isChainToolCollapsed,
  toggleChainToolsAfter,
} from '#/tui/features/transcript/toggle-chain-tools';
import type { Component } from '#/tui/renderer';
import type { ToolCallBlockData } from '#/tui/types';

function makeTool(
  id: string,
  detail: 'minimal' | 'compact' | 'standard' | 'full' = 'minimal',
): ToolCallComponent {
  const toolCall: ToolCallBlockData = {
    id,
    name: 'Read',
    args: { file_path: `${id}.ts` },
  };
  const tc = new ToolCallComponent(toolCall, undefined);
  tc.setDetail(detail);
  return tc;
}

describe('toggle-chain-tools', () => {
  it('collects tools after chain until the next user message', () => {
    const chain = new ToolChainSummaryComponent();
    const t1 = makeTool('a');
    const t2 = makeTool('b');
    const user = new UserMessageComponent('next turn');
    const t3 = makeTool('c');
    const children: Component[] = [chain, t1, t2, user, t3];
    const tools = collectToolsAfterChain(children, 0);
    expect(tools).toEqual([t1, t2]);
  });

  it('stops collection at the answer (assistant) phase', () => {
    const chain = new ToolChainSummaryComponent();
    const t1 = makeTool('a');
    const answer = new AssistantMessageComponent();
    answer.updateContent('done');
    const t2 = makeTool('b');
    expect(collectToolsAfterChain([chain, t1, answer, t2], 0)).toEqual([t1]);
  });

  it('includes tools borrowed by AgentGroupComponent', () => {
    const chain = new ToolChainSummaryComponent();
    const solo = makeTool('solo');
    const grouped = makeTool('grouped');
    const group = new AgentGroupComponent(undefined);
    group.attach(grouped.toolCallId, grouped);
    const tools = collectToolsAfterChain([chain, solo, group], 0);
    expect(tools).toEqual([solo, grouped]);
  });

  it('expands chain-hidden tools on first toggle at minimal', () => {
    const chain = new ToolChainSummaryComponent();
    const t1 = makeTool('a', 'minimal');
    const t2 = makeTool('b', 'minimal');
    expect(t1.isChainHidden).toBe(true);
    const children: Component[] = [chain, t1, t2];
    const n = toggleChainToolsAfter(children, 0);
    expect(n).toBe(2);
    expect(t1.isChainHidden).toBe(false);
    expect(t2.isChainHidden).toBe(false);
  });

  it('collapses all tools on second chain toggle (round-trip)', () => {
    const chain = new ToolChainSummaryComponent();
    const t1 = makeTool('a', 'minimal');
    const t2 = makeTool('b', 'minimal');
    const children: Component[] = [chain, t1, t2];
    expect(toggleChainToolsAfter(children, 0)).toBe(2);
    expect(isChainToolCollapsed(t1)).toBe(false);
    expect(toggleChainToolsAfter(children, 0)).toBe(2);
    expect(t1.isChainHidden).toBe(true);
    expect(t2.isChainHidden).toBe(true);
  });

  it('expands and collapses compact one-line cards as a unit', () => {
    const chain = new ToolChainSummaryComponent();
    const t1 = makeTool('a', 'compact');
    const t2 = makeTool('b', 'compact');
    const children: Component[] = [chain, t1, t2];
    expect(t1.isOneLineCollapsed).toBe(true);
    expect(toggleChainToolsAfter(children, 0)).toBe(2);
    expect(t1.isOneLineCollapsed).toBe(false);
    expect(t2.isOneLineCollapsed).toBe(false);
    expect(toggleChainToolsAfter(children, 0)).toBe(2);
    expect(t1.isOneLineCollapsed).toBe(true);
  });

  it('skips standard/full tools (no one-line collapse semantics)', () => {
    const chain = new ToolChainSummaryComponent();
    const t1 = makeTool('a', 'standard');
    const t2 = makeTool('b', 'full');
    expect(isChainToggleableTool(t1)).toBe(false);
    expect(isChainToggleableTool(t2)).toBe(false);
    expect(toggleChainToolsAfter([chain, t1, t2], 0)).toBe(0);
  });

  it('returns 0 when no tools follow the chain', () => {
    const chain = new ToolChainSummaryComponent();
    expect(toggleChainToolsAfter([chain], 0)).toBe(0);
    expect(toggleChainToolsAfter([], -1)).toBe(0);
  });
});
