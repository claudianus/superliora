import type { RendererRootUI } from '#/tui/renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchGroupComponent, formatSearchHitTotals } from '#/tui/components/messages/search-group';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import type { ToolCallSearchSnapshot } from '#/tui/components/messages/tool-call/search-snapshot';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function stubTui(): RendererRootUI {
  return {
    terminal: { rows: 40 },
    requestRender: vi.fn(),
  } as unknown as RendererRootUI;
}

function renderText(component: SearchGroupComponent, width = 120): string {
  return strip(component.render(width).join('\n'));
}

function createSearchTool(
  id: string,
  name: string,
  args: Record<string, unknown>,
  ui: RendererRootUI,
): ToolCallComponent {
  return new ToolCallComponent({ id, name, args }, undefined, ui);
}

describe('SearchGroupComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses present tense while any member is still running', () => {
    const ui = stubTui();
    const group = new SearchGroupComponent(ui);
    const grep = createSearchTool('g1', 'Grep', { pattern: 'TODO' }, ui);
    const glob = createSearchTool('gl1', 'Glob', { pattern: '**/*.ts' }, ui);
    group.attach('g1', grep);
    group.attach('gl1', glob);

    const output = renderText(group);
    expect(output).toContain('Searching 2 patterns…');
    expect(output).toContain('TODO');
    expect(output).toContain('searching…');
    expect(output).toContain('**/*.ts');

    group.dispose();
    grep.dispose();
    glob.dispose();
  });

  it('settles to past tense with mixed Grep/LS hit totals', () => {
    const ui = stubTui();
    const group = new SearchGroupComponent(ui);
    const grep = createSearchTool('g1', 'Grep', { pattern: 'foo' }, ui);
    const ls = createSearchTool('ls1', 'LS', { path: 'src' }, ui);
    group.attach('g1', grep);
    group.attach('ls1', ls);

    grep.setResult({
      tool_call_id: 'g1',
      output: 'a.ts:1:foo\nb.ts:2:foo\n',
      is_error: false,
    });
    ls.setResult({
      tool_call_id: 'ls1',
      output: 'a.ts\nb.ts\nc.ts\n',
      is_error: false,
    });

    const output = renderText(group);
    expect(output).toContain('Searched 1 pattern · Listed 1 dir');
    expect(output).toContain('2 matches');
    expect(output).toContain('3 files');
    expect(output).toContain('foo');
    expect(output).toContain('src');
    expect(output).not.toContain('searching…');

    group.dispose();
    grep.dispose();
    ls.dispose();
  });

  it('marks a mixed run failed when every member errors', () => {
    const ui = stubTui();
    const group = new SearchGroupComponent(ui);
    const a = createSearchTool('g1', 'Grep', { pattern: 'x' }, ui);
    const b = createSearchTool('g2', 'Grep', { pattern: 'y' }, ui);
    group.attach('g1', a);
    group.attach('g2', b);
    a.setResult({ tool_call_id: 'g1', output: 'boom', is_error: true });
    b.setResult({ tool_call_id: 'g2', output: 'boom', is_error: true });

    const output = renderText(group);
    expect(output).toContain('Searched 2 patterns');
    expect(output).toContain('failed');
    expect(output).not.toContain('matches');

    group.dispose();
    a.dispose();
    b.dispose();
  });

  it('appends a failure count when only some members fail', () => {
    const ui = stubTui();
    const group = new SearchGroupComponent(ui);
    const ok = createSearchTool('g1', 'Grep', { pattern: 'ok' }, ui);
    const bad = createSearchTool('g2', 'Grep', { pattern: 'bad' }, ui);
    group.attach('g1', ok);
    group.attach('g2', bad);
    ok.setResult({ tool_call_id: 'g1', output: 'hit\n', is_error: false });
    bad.setResult({ tool_call_id: 'g2', output: 'nope', is_error: true });

    const output = renderText(group);
    expect(output).toContain('Searched 2 patterns');
    expect(output).toContain('1 match');
    expect(output).toContain('1 failed');

    group.dispose();
    ok.dispose();
    bad.dispose();
  });
});

describe('formatSearchHitTotals', () => {
  const done = (
    name: string,
    hitKind: ToolCallSearchSnapshot['hitKind'],
    hits: number,
  ): ToolCallSearchSnapshot => ({
    toolCallId: name,
    name,
    kind: hitKind === 'file' && name === 'LS' ? 'dir' : 'search',
    subject: name,
    phase: 'done',
    hits,
    hitKind,
  });

  it('joins match and file totals from settled members only', () => {
    expect(
      formatSearchHitTotals([
        done('Grep', 'match', 4),
        { ...done('Glob', 'file', 2), phase: 'pending', hits: 0 },
        done('LS', 'file', 3),
      ]),
    ).toBe(' · 4 matches · 3 files');
  });
});
