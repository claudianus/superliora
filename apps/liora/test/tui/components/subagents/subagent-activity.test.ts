import { visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { clearHighlightCache } from '#/tui/components/media/code-highlight';
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
  const previousChalkLevel = chalk.level;

  afterEach(() => {
    chalk.level = previousChalkLevel;
    // The highlight cache key does not include chalk's color level, so drop
    // it between tests to keep ANSI assertions deterministic.
    clearHighlightCache();
  });

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
      argsPreview: '{"path":"packages/agent-core/src/session/subagent/subagent-host.ts"}',
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

  it('renders a highlighted code preview under Write feed lines', () => {
    chalk.level = 3;
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-write',
      name: 'Write',
      argsPreview:
        '{"path":"src/b.ts","content":"const answer = 42;\\nexport function f() {\\n  return answer;\\n}"}',
      detail: { kind: 'write', path: 'src/b.ts', lines: 4, bytes: 64 },
    });

    const raw = component.render(120);
    const plain = raw.map((line) => strip(line).trimEnd());
    expect(plain.some((line) => line.includes('▸ Write src/b.ts 4 lines'))).toBe(true);

    const codeRows = raw.filter((line) => {
      const text = strip(line);
      return text.includes('const answer = 42;') || text.includes('export function f() {');
    });
    expect(codeRows).toHaveLength(2);
    // Syntax colors from the shared highlighter, indented under the feed row.
    expect(codeRows.every((line) => line.includes('\u001B['))).toBe(true);
    for (const line of codeRows) {
      expect(strip(line).startsWith('      ')).toBe(true);
    }
    // The preview sits directly under its feed row.
    const feedIndex = plain.findIndex((line) => line.includes('▸ Write src/b.ts'));
    expect(strip(raw[feedIndex + 1] ?? '').includes('const answer = 42;')).toBe(true);
  });

  it('highlights the new_string preview under Edit feed lines', () => {
    chalk.level = 3;
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-edit',
      name: 'Edit',
      argsPreview:
        '{"path":"src/a.ts","old_string":"const a = 1;","new_string":"const a = 2;\\nconst b = 3;"}',
      detail: { kind: 'edit', path: 'src/a.ts', addedLines: 2, removedLines: 1 },
    });

    const raw = component.render(120);
    const plain = raw.map((line) => strip(line).trimEnd());
    expect(plain.some((line) => line.includes('▸ Edit src/a.ts +2 -1'))).toBe(true);
    const addedRow = raw.find((line) => strip(line).includes('const a = 2;'));
    expect(addedRow).toBeDefined();
    expect(addedRow?.includes('\u001B[')).toBe(true);
    // Only the code being written is previewed, not the replaced side.
    expect(plain.some((line) => line.includes('const a = 1;'))).toBe(false);
  });

  it('keeps the plain feed row when detail is missing', () => {
    chalk.level = 3;
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Write',
      argsPreview: '{"path":"src/b.ts","content":"const x = 1;"}',
    });

    const raw = component.render(120);
    // Blank + header + agent row + one feed row, no indented code block.
    expect(raw).toHaveLength(4);
    expect(raw.every((line) => ! strip(line).startsWith('      '))).toBe(true);
    expect(strip(raw[3] ?? '').includes('▸ Write {"path":"src/b.ts"')).toBe(true);
  });

  it('skips the preview when the extracted content is blank', () => {
    chalk.level = 3;
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Write',
      argsPreview: '{"path":"src/b.ts","content":"\\n\\n"}',
      detail: { kind: 'write', path: 'src/b.ts', lines: 2, bytes: 2 },
    });

    expect(component.render(120)).toHaveLength(4);
  });

  it('keeps the feed height bounded when previews highlight', () => {
    chalk.level = 3;
    const component = createComponent();
    for (let n = 1; n <= 5; n += 1) {
      component.recordToolCall({
        subagentId: 'agent-0',
        subagentName: 'coder',
        toolCallId: `call-${n}`,
        name: 'Write',
        argsPreview: `{"path":"src/f${n}.ts","content":"const c${n}a = 1;\\nconst c${n}b = 2;\\nconst c${n}c = 3;\\nconst c${n}d = 4;"}`,
        detail: { kind: 'write', path: `src/f${n}.ts`, lines: 4, bytes: 64 },
      });
    }

    const raw = component.render(120);
    const plain = raw.map((line) => strip(line).trimEnd());
    // Entry cap: only the last three calls keep a feed row.
    expect(plain.some((line) => line.includes('src/f1.ts'))).toBe(false);
    expect(plain.some((line) => line.includes('src/f2.ts'))).toBe(false);
    // Blank + header + agent row + 3 entries + at most 3 preview rows.
    expect(raw.length).toBeLessThanOrEqual(1 + 1 + 1 + 3 + 3);
    // Only the newest entry gets a preview, capped at three code lines.
    expect(plain.some((line) => line.includes('const c5a = 1;'))).toBe(true);
    expect(plain.some((line) => line.includes('const c5c = 3;'))).toBe(true);
    expect(plain.some((line) => line.includes('const c5d = 4;'))).toBe(false);
    expect(plain.some((line) => line.includes('const c4a = 1;'))).toBe(false);
    expect(plain.some((line) => line.includes('const c3a = 1;'))).toBe(false);
  });

  it('leaves non-code tool rows without a preview', () => {
    chalk.level = 3;
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-bash',
      name: 'Bash',
      argsPreview: '{"command":"pnpm test"}',
      detail: { kind: 'bash', command: 'pnpm test' },
    });
    component.recordToolCall({
      subagentId: 'agent-0',
      toolCallId: 'call-read',
      name: 'Read',
      detail: { kind: 'read', path: 'src/c.ts' },
    });

    const raw = component.render(120);
    // Blank + header + agent row + two feed rows, no code block.
    expect(raw).toHaveLength(5);
    expect(raw.every((line) => ! strip(line).startsWith('      '))).toBe(true);
  });

  it('keeps highlighted rows within very narrow widths', () => {
    chalk.level = 3;
    const component = createComponent();
    component.recordToolCall({
      subagentId: 'agent-0',
      subagentName: 'coder',
      toolCallId: 'call-1',
      name: 'Write',
      argsPreview:
        '{"path":"src/b.ts","content":"const answer = 42;\\nexport function f() {\\n  return answer;\\n}"}',
      detail: { kind: 'write', path: 'src/b.ts', lines: 4, bytes: 64 },
    });

    for (const width of [10, 24, 39]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
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
