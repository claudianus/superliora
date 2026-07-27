import { visibleWidth } from '#/tui/renderer';
import { describe, expect, it } from 'vitest';

import {
  SubagentActivityComponent,
  describeSubagentToolFeedBody,
} from '#/tui/components/subagents/subagent-activity';

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

  it('renders structured detail targets and chips for common tools', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-edit',
      name: 'Edit',
      detail: { kind: 'edit', path: 'src/a.ts', addedLines: 3, removedLines: 1 },
    });
    component.recordToolCall({
      subagentId: 'agent-0',
      toolCallId: 'call-write',
      name: 'Write',
      detail: { kind: 'write', path: 'src/b.ts', lines: 12, bytes: 340 },
    });
    component.recordToolCall({
      subagentId: 'agent-1',
      subagentName: 'explore',
      toolCallId: 'call-bash',
      name: 'Bash',
      detail: { kind: 'bash', command: 'pnpm test' },
    });
    component.recordToolCall({
      subagentId: 'agent-1',
      toolCallId: 'call-grep',
      name: 'Grep',
      detail: { kind: 'search', pattern: 'foo\\d+' },
    });
    component.recordToolCall({
      subagentId: 'agent-1',
      toolCallId: 'call-read',
      name: 'Read',
      detail: { kind: 'read', path: 'src/c.ts' },
    });

    const lines = plainLines(component);
    expect(lines.some((line) => line.includes('▸ Edit src/a.ts +3 -1'))).toBe(true);
    expect(lines.some((line) => line.includes('▸ Write src/b.ts 12 lines'))).toBe(true);
    expect(lines.some((line) => line.includes('▸ Bash pnpm test'))).toBe(true);
    expect(lines.some((line) => line.includes('▸ Grep foo\\d+'))).toBe(true);
    expect(lines.some((line) => line.includes('▸ Read src/c.ts'))).toBe(true);
    // Detail replaces the raw args preview on the same row.
    expect(lines.some((line) => line.includes('{'))).toBe(false);
  });

  it('keeps chips on settled rows and falls back to args preview without detail', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Edit',
      detail: { kind: 'edit', path: 'src/a.ts', addedLines: 2, removedLines: 0 },
    });
    component.recordToolCall({
      subagentId: 'agent-0',
      toolCallId: 'call-2',
      name: 'FetchURL',
      argsPreview: 'https://example.com',
    });
    component.recordToolResult({ subagentId: 'agent-0', toolCallId: 'call-1' });
    component.recordToolResult({ subagentId: 'agent-0', toolCallId: 'call-2', isError: true });

    const lines = plainLines(component);
    expect(lines.some((line) => line.includes('✓ Edit src/a.ts +2'))).toBe(true);
    expect(lines.some((line) => line.includes('✗ FetchURL https://example.com'))).toBe(true);
  });

  it('omits the edit chip when nothing changed', () => {
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Edit',
      detail: { kind: 'edit', path: 'src/a.ts', addedLines: 0, removedLines: 0 },
    });

    const lines = plainLines(component);
    expect(lines.some((line) => line.includes('▸ Edit src/a.ts'))).toBe(true);
    expect(lines.some((line) => line.includes('+0'))).toBe(false);
  });
});

describe('describeSubagentToolFeedBody', () => {
  it('composes name, target, and chip into one compact line', () => {
    expect(
      describeSubagentToolFeedBody(
        'Edit',
        { kind: 'edit', path: 'src/a.ts', addedLines: 3, removedLines: 1 },
        undefined,
      ),
    ).toBe('Edit src/a.ts +3 -1');
    expect(
      describeSubagentToolFeedBody('Write', { kind: 'write', path: 'src/b.ts', lines: 1, bytes: 2 }, undefined),
    ).toBe('Write src/b.ts 1 line');
    expect(
      describeSubagentToolFeedBody('Read', { kind: 'read', path: 'src/c.ts' }, undefined),
    ).toBe('Read src/c.ts');
    expect(
      describeSubagentToolFeedBody('Bash', { kind: 'bash', command: 'pnpm test' }, undefined),
    ).toBe('Bash pnpm test');
    expect(
      describeSubagentToolFeedBody('Grep', { kind: 'search', pattern: 'foo.*' }, undefined),
    ).toBe('Grep foo.*');
  });

  it('falls back to the args preview and bare name', () => {
    expect(describeSubagentToolFeedBody('FetchURL', undefined, '{"url":"x"}')).toBe(
      'FetchURL {"url":"x"}',
    );
    expect(describeSubagentToolFeedBody('Tool', undefined, undefined)).toBe('Tool');
  });
});
