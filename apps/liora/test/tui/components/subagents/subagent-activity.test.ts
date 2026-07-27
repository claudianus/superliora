import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it } from 'vitest';

import { SubagentActivityComponent } from '#/tui/components/subagents/subagent-activity';

// Fixed clock keeps settle-flash / pulse assertions deterministic; the
// component reads time through the injectable `now` option. Renders happen
// AFTER_SETTLE so completed rows take the static (non-flash) branch.
const NOW = 1_000_000;
const AFTER_SETTLE = NOW + 10_000;

function strip(text: string): string {
  // Drop ANSI colors and ambient sparkles (pulse / spectacular glyphs).
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '').replaceAll(/[∙•◦*✦✧]/g, '');
}

function plainLines(component: SubagentActivityComponent, width = 120): string[] {
  return component.render(width).map((line) => strip(line).trimEnd());
}

function createComponent(now: () => number = () => AFTER_SETTLE): SubagentActivityComponent {
  return new SubagentActivityComponent({ now });
}

describe('SubagentActivityComponent', () => {
  it('renders nothing while no subagents are tracked', () => {
    expect(plainLines(createComponent())).toEqual(['']);
  });

  it('renders a running tool call with name and args preview', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Edit',
      argsPreview: 'src/a.ts',
    });

    const lines = plainLines(component);
    expect(lines[0]).toBe('');
    expect(lines.some((line) => line.includes('Subagent activity'))).toBe(true);
    expect(lines.some((line) => line.includes('● coder'))).toBe(true);
    expect(lines.some((line) => line.includes('▸ Edit src/a.ts'))).toBe(true);
    expect(component.hasActiveAgents()).toBe(true);
  });

  it('settles running entries to ok / error marks on tool results', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Read',
      argsPreview: 'src/b.ts',
    });
    component.recordToolCall({
      subagentId: 'agent-0',
      toolCallId: 'call-2',
      name: 'Bash',
      argsPreview: 'pnpm test',
    });
    component.recordToolResult({ subagentId: 'agent-0', toolCallId: 'call-1' });
    component.recordToolResult({ subagentId: 'agent-0', toolCallId: 'call-2', isError: true });

    const lines = plainLines(component);
    expect(lines.some((line) => line.includes('✓ Read src/b.ts'))).toBe(true);
    expect(lines.some((line) => line.includes('✗ Bash pnpm test'))).toBe(true);
    expect(lines.some((line) => line.includes('▸'))).toBe(false);
  });

  it('shows only the last three tool entries per agent', () => {
    const component = createComponent();
    for (let index = 1; index <= 5; index += 1) {
      component.recordToolCall({
        subagentId: 'agent-0',
        subagentName: 'coder',
        toolCallId: `call-${index}`,
        name: `Tool${index}`,
      });
    }

    const lines = plainLines(component);
    expect(lines.some((line) => line.includes('Tool1'))).toBe(false);
    expect(lines.some((line) => line.includes('Tool2'))).toBe(false);
    expect(lines.some((line) => line.includes('Tool3'))).toBe(true);
    expect(lines.some((line) => line.includes('Tool4'))).toBe(true);
    expect(lines.some((line) => line.includes('Tool5'))).toBe(true);
  });

  it('marks terminal agents with success / failure glyphs', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Edit',
    });
    component.recordToolCall({
      subagentId: 'agent-1',
      subagentName: 'explore',
      toolCallId: 'call-2',
      name: 'Grep',
    });
    component.markTerminal('agent-0', 'completed');
    component.markTerminal('agent-1', 'failed');

    const lines = plainLines(component);
    expect(lines.some((line) => line.includes('✓ coder'))).toBe(true);
    expect(lines.some((line) => line.includes('✗ explore'))).toBe(true);
    expect(component.hasActiveAgents()).toBe(false);
  });

  it('prunes terminal agents and resets cleanly', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Edit',
    });
    component.markTerminal('agent-0', 'completed');
    component.pruneTerminal();
    expect(plainLines(component)).toEqual(['']);

    component.recordToolCall({
      subagentId: 'agent-1',
      subagentName: 'explore',
      toolCallId: 'call-2',
      name: 'Read',
    });
    component.reset();
    expect(component.agentCount).toBe(0);
    expect(plainLines(component)).toEqual(['']);
  });

  it('keeps every rendered row within very narrow widths', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Edit',
      argsPreview: '{"path":"packages/agent-core/src/session/subagent-host.ts"}',
    });
    component.recordToolResult({ subagentId: 'agent-0', toolCallId: 'call-1' });

    for (const width of [1, 2, 4, 10, 39]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
