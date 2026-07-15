import { describe, expect, it } from 'vitest';

import {
  computeEditStats,
  computeWriteStats,
  pickChip,
} from '#/tui/components/messages/tool-renderers/chip';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

function strip(text: string): string {
  return text.replaceAll(/\[[0-9;]*m/g, '');
}

function call(name: string, args: Record<string, unknown> = {}): ToolCallBlockData {
  return { id: 'tc', name, args };
}

function result(output: string, isError = false): ToolResultBlockData {
  return { tool_call_id: 'tc', output, is_error: isError };
}

function chipFor(name: string, args: Record<string, unknown>, out: ToolResultBlockData): string {
  const provider = pickChip(name);
  return strip(provider?.(call(name, args), out) ?? '');
}

describe('chip registry', () => {
  it('Bash has no chip (exit code is not surfaced)', () => {
    expect(pickChip('Bash')).toBeUndefined();
  });

  it('Edit chip shows +N -M from args diff', () => {
    const c = chipFor(
      'Edit',
      { path: 'foo.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' },
      result('Replaced 1 occurrence in foo.ts'),
    );
    expect(c).toMatch(/\+\d+/);
    expect(c).toMatch(/-\d+/);
  });

  it('Write chip shows N lines from content arg', () => {
    expect(chipFor('Write', { path: 'a.txt', content: 'a\nb\nc\n' }, result('Wrote a.txt'))).toBe(
      '3 lines',
    );
  });

  it('Read chip shows line count', () => {
    expect(chipFor('Read', { path: 'a.ts' }, result('1\tfoo\n2\tbar\n3\tbaz'))).toBe('3 lines');
  });

  it('Read chip handles single line as singular', () => {
    expect(chipFor('Read', { path: 'a.ts' }, result('1\tfoo'))).toBe('1 line');
  });

  it('Grep chip shows match count', () => {
    expect(chipFor('Grep', { pattern: 'foo' }, result('a.ts\nb.ts\nc.ts'))).toBe('3 matches');
  });

  it('Grep chip says "no matches" on empty result', () => {
    expect(chipFor('Grep', { pattern: 'foo' }, result(''))).toBe('no matches');
  });

  it('Glob chip shows file count', () => {
    expect(chipFor('Glob', { pattern: '**/*.ts' }, result('a.ts\nb.ts'))).toBe('2 files');
  });

  it('FetchURL chip shows size and is non-empty', () => {
    const out = chipFor('FetchURL', { url: 'https://example.com' }, result('hello world'));
    expect(out).toMatch(/\d+\s*B/);
  });

  it('WebSearch chip shows result count from Title lines', () => {
    expect(
      chipFor(
        'WebSearch',
        { query: 'kimi' },
        result('Title: Alpha\nURL: https://a.test\n\n---\n\nTitle: Beta\nURL: https://b.test\n\n---\n\nTitle: Gamma\nURL: https://c.test\n'),
      ),
    ).toBe('3 results');
  });

  it('WebSearch chip still counts numbered list fallbacks', () => {
    expect(chipFor('WebSearch', { query: 'kimi' }, result('1. Alpha\n2. Beta\n3. Gamma'))).toBe(
      '3 results',
    );
  });

  it('Think tool has no chip', () => {
    expect(pickChip('Think')).toBeUndefined();
  });

  it('GetGoal chip shows the current status', () => {
    expect(chipFor('GetGoal', {}, result('{"goal":{"status":"active"}}'))).toBe('active');
  });

  it('GetGoal chip shows when there is no current goal', () => {
    expect(chipFor('GetGoal', {}, result('{"goal":null}'))).toBe('no goal');
  });

  it('CreateGoal chip shows the created status', () => {
    expect(chipFor('CreateGoal', { objective: 'Ship feature X' }, result('{"goal":{"status":"active"}}'))).toBe('active');
  });

  it('SetGoalBudget has no chip because the budget is in the header argument', () => {
    expect(pickChip('SetGoalBudget')).toBeUndefined();
  });

  it('UpdateGoal has no chip because the status is in the header label', () => {
    expect(pickChip('UpdateGoal')).toBeUndefined();
  });

  it('GenerateImage chip shows path basename and bytes', () => {
    const text = chipFor(
      'GenerateImage',
      { prompt: 'logo' },
      result(
        'Generated image with openai.\nPath: .superliora/generated/images/x.png\nBytes: 2048\nMIME: image/png',
      ),
    );
    expect(text).toContain('x.png');
    expect(text).toMatch(/2(\.0)? KB|2048 B/);
  });
  it('LioraRead chip shows mode and rendered/total lines from tool_meta', () => {
    const out = chipFor(
      'LioraRead',
      { path: 'src/foo.ts' },
      result(
        [
          'export function foo() {}',
          '<tool_meta tool="LioraRead" mode="signatures">',
          'truncated: false',
          'partial: false',
          'summary: Rendered 12 of 40 lines for src/foo.ts.',
          'total_lines: 40',
          'rendered_lines: 12',
          '</tool_meta>',
        ].join('\n'),
      ),
    );
    expect(out).toBe('signatures · 12/40 lines');
  });

  it('LioraSymbol chip shows definition and reference counts', () => {
    const out = chipFor(
      'LioraSymbol',
      { name: 'GoalInjector' },
      result(
        [
          '<liora_symbol name="GoalInjector">',
          'definitions: 1',
          '- packages/agent-core/src/agent/injection/goal.ts:L15 def export class GoalInjector',
          'references: 2',
          '- packages/agent-core/src/agent/injection/manager.ts:L40 ref GoalInjector',
          '</liora_symbol>',
        ].join('\n'),
      ),
    );
    expect(out).toBe('1 def · 2 refs');
  });

  it('LioraTree chip counts body entries', () => {
    const out = chipFor(
      'LioraTree',
      { path: 'src' },
      result(['<liora_tree>', 'a.ts', 'b/', 'b/c.ts', '</liora_tree>'].join('\n')),
    );
    expect(out).toBe('3 entries');
  });

  it('LioraExpand chip shows window range when present', () => {
    const out = chipFor(
      'LioraExpand',
      { id: 'arch-1' },
      result(
        [
          '<liora_expand id="arch-1" label="src/foo.ts">',
          'window: 1-20 of 200',
          '1\tline one',
          '</liora_expand>',
        ].join('\n'),
      ),
    );
    expect(out).toBe('1-20/200 lines');
  });


  it('Unknown tools have no chip', () => {
    expect(pickChip('SomethingElse')).toBeUndefined();
  });
});

describe('computeWriteStats', () => {
  it('returns zero lines for empty content', () => {
    expect(computeWriteStats({})).toEqual({ lines: 0 });
    expect(computeWriteStats({ content: '' })).toEqual({ lines: 0 });
  });

  it('counts a single line with no trailing newline', () => {
    expect(computeWriteStats({ content: 'hello' })).toEqual({ lines: 1 });
  });

  it('ignores trailing newline so "a\\nb\\n" is 2 lines', () => {
    expect(computeWriteStats({ content: 'a\nb\n' })).toEqual({ lines: 2 });
    expect(computeWriteStats({ content: 'a\nb' })).toEqual({ lines: 2 });
  });
});

describe('computeEditStats', () => {
  it('returns zero when both strings are empty', () => {
    expect(computeEditStats({})).toEqual({ added: 0, removed: 0 });
    expect(computeEditStats({ old_string: '', new_string: '' })).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it('counts added and removed lines for a replacement', () => {
    const stats = computeEditStats({ old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' });
    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
  });

  it('counts only adds when old is empty', () => {
    const stats = computeEditStats({ old_string: '', new_string: 'x\ny\nz' });
    expect(stats.added).toBe(3);
    expect(stats.removed).toBe(0);
  });
});


