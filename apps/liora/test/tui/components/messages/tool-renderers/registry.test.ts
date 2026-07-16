import type { Component } from '#/tui/renderer';
import { describe, expect, it } from 'vitest';

import {
  isGenericToolResult,
  pickResultRenderer,
} from '#/tui/components/messages/tool-renderers/registry';
import { darkColors } from '#/tui/theme/colors';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

function strip(text: string): string {
  return text.replaceAll(/\[[0-9;]*m/g, '');
}

function joinRender(components: Component[], width = 100): string {
  return components.flatMap((c) => c.render(width)).join('\n');
}

function call(name: string, args: Record<string, unknown> = {}): ToolCallBlockData {
  return { id: 'tc', name, args };
}

function result(output: string, isError = false): ToolResultBlockData {
  return { tool_call_id: 'tc', output, is_error: isError };
}

const ctx = { expanded: false, colors: darkColors };
const expandedCtx = { expanded: true, colors: darkColors };

function goalOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    goal: {
      goalId: 'g1',
      objective: 'Ship feature X',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      startedBy: 'model',
      updatedBy: 'model',
      turnsUsed: 2,
      tokensUsed: 1234,
      wallClockMs: 61000,
      budget: {
        tokenBudget: null,
        turnBudget: null,
        wallClockBudgetMs: null,
        remainingTokens: null,
        remainingTurns: null,
        remainingWallClockMs: null,
        tokenBudgetReached: false,
        turnBudgetReached: false,
        wallClockBudgetReached: false,
        overBudget: false,
      },
      ...overrides,
    },
  });
}

describe('tool-result registry', () => {
  it('falls back to truncated renderer for unknown tools', () => {
    const renderer = pickResultRenderer('SomethingUnknown');
    const out = strip(joinRender(renderer(call('SomethingUnknown'), result('a\nb\nc\nd\ne'), ctx)));
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).not.toContain('\nd');
    expect(out).toContain('... (3 more lines, ctrl+o to expand)');
  });

  it('uses truncated renderer for Bash to preserve raw output UX', () => {
    const renderer = pickResultRenderer('Bash');
    const out = strip(joinRender(renderer(call('Bash'), result('one\ntwo\nthree\nfour'), ctx)));
    expect(out).toContain('one');
    expect(out).toContain('... (2 more lines, ctrl+o to expand)');
  });

  it('Read renders no body when collapsed (header chip carries the count)', () => {
    const renderer = pickResultRenderer('Read');
    const out = joinRender(
      renderer(call('Read', { path: 'foo.ts' }), result('1\tfoo\n2\tbar'), ctx),
    );
    expect(out.trim()).toBe('');
  });

  it('GenerateImage uses the media summary renderer (path glance, collapsed body)', () => {
    const renderer = pickResultRenderer('GenerateImage');
    const out = strip(
      joinRender(
        renderer(
          call('GenerateImage', { prompt: 'logo', path: 'out.png' }),
          result('Generated image with openai.\nPath: out.png\nBytes: 1234\nMIME: image/png'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('out.png');
    expect(isGenericToolResult('GenerateImage')).toBe(false);
  });

  it('Read expands to the raw file content when expanded', () => {
    const renderer = pickResultRenderer('Read');
    const out = strip(
      joinRender(renderer(call('Read', { path: 'foo.ts' }), result('1\tfoo\n2\tbar'), expandedCtx)),
    );
    expect(out).toContain('foo');
    expect(out).toContain('bar');
  });

  it('WebSearch glance lists result titles below the chip', () => {
    const renderer = pickResultRenderer('WebSearch');
    const out = strip(
      joinRender(
        renderer(
          call('WebSearch', { query: 'kimi' }),
          result('Title: Alpha\nURL: https://a.test\n\n---\n\nTitle: Beta\nURL: https://b.test\n'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('Alpha');
    expect(out).toContain('Beta');
  });
  it('LioraRead glance surfaces mode and summary without dumping the file body', () => {
    const renderer = pickResultRenderer('LioraRead');
    const out = strip(
      joinRender(
        renderer(
          call('LioraRead', { path: 'src/foo.ts' }),
          result(
            [
              'export function foo() {}',
              'export function bar() {}',
              '<tool_meta tool="LioraRead" mode="signatures">',
              'summary: Rendered 12 of 40 lines for src/foo.ts.',
              'total_lines: 40',
              'rendered_lines: 12',
              '</tool_meta>',
            ].join('\n'),
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('signatures');
    expect(out).toContain('Rendered 12 of 40 lines');
    expect(out).not.toContain('export function bar');
    expect(isGenericToolResult('LioraRead')).toBe(false);
  });

  it('LioraSymbol glance lists definition samples', () => {
    const renderer = pickResultRenderer('LioraSymbol');
    const out = strip(
      joinRender(
        renderer(
          call('LioraSymbol', { name: 'GoalInjector' }),
          result(
            [
              '<liora_symbol name="GoalInjector">',
              'definitions: 1',
              '- packages/agent-core/src/agent/injection/goal.ts:L15 def export class GoalInjector',
              'references: 1',
              '- packages/agent-core/src/agent/injection/manager.ts:L40 ref GoalInjector',
              '</liora_symbol>',
            ].join('\n'),
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('goal.ts');
    expect(out).toContain('manager.ts');
    expect(isGenericToolResult('LioraSymbol')).toBe(false);
  });

  it('LioraTree glance samples tree rows', () => {
    const renderer = pickResultRenderer('LioraTree');
    const out = strip(
      joinRender(
        renderer(
          call('LioraTree', { path: 'src' }),
          result(['<liora_tree>', 'a.ts', 'b/', 'b/c.ts', 'd.ts', '</liora_tree>'].join('\n')),
          ctx,
        ),
      ),
    );
    expect(out).toContain('a.ts');
    expect(out).toContain('b/');
    expect(out).toContain('+1 more');
    expect(isGenericToolResult('LioraTree')).toBe(false);
  });
  it('Context7Resolve glance lists library titles and ids', () => {
    const renderer = pickResultRenderer('Context7Resolve');
    const out = strip(
      joinRender(
        renderer(
          call('Context7Resolve', { library_name: 'react', query: 'hooks' }),
          result(
            [
              '- Title: React',
              '- Context7-compatible library ID: /reactjs/react.dev',
              '- Title: React Router',
              '- Context7-compatible library ID: /remix-run/react-router',
            ].join('\n'),
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('React');
    expect(out).toContain('/reactjs/react.dev');
    expect(isGenericToolResult('Context7Resolve')).toBe(false);
  });

  it('Context7Docs glance lists library id and snippet titles', () => {
    const renderer = pickResultRenderer('Context7Docs');
    const out = strip(
      joinRender(
        renderer(
          call('Context7Docs', { library_id: '/reactjs/react.dev', query: 'useEffect' }),
          result('Title: useEffect\nSOURCE: https://react.dev\n\nTitle: Rules of Hooks\nSOURCE: https://react.dev/rules'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('/reactjs/react.dev');
    expect(out).toContain('useEffect');
    expect(isGenericToolResult('Context7Docs')).toBe(false);
  });
  it('SearchSkill glance lists skill names', () => {
    const renderer = pickResultRenderer('SearchSkill');
    const out = strip(
      joinRender(
        renderer(
          call('SearchSkill', { query: 'no-ai-slop' }),
          result(
            [
              '<skill-candidate rank="1" name="no-ai-slop" source="bundled" score="0.9" match_reason="name">',
              '  <description>Human writing</description>',
              '</skill-candidate>',
              '<skill-candidate rank="2" name="write-tui" source="bundled" score="0.7" match_reason="tag">',
              '  <description>TUI</description>',
              '</skill-candidate>',
            ].join('\n'),
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('no-ai-slop');
    expect(out).toContain('write-tui');
    expect(isGenericToolResult('SearchSkill')).toBe(false);
  });

  it('SearchExpert glance lists expert names', () => {
    const renderer = pickResultRenderer('SearchExpert');
    const out = strip(
      joinRender(
        renderer(
          call('SearchExpert', { query: 'frontend' }),
          result(
            [
              '<expert-candidate rank="1" id="fe" name="Frontend Engineer" division="product" division_label="Product" score="0.8">',
              '  <description>UI</description>',
              '</expert-candidate>',
            ].join('\n'),
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('Frontend Engineer');
    expect(isGenericToolResult('SearchExpert')).toBe(false);
  });
  it('Skill glance shows loaded skill name without expand', () => {
    const renderer = pickResultRenderer('Skill');
    const out = strip(
      joinRender(
        renderer(
          call('Skill', { skill: 'no-ai-slop' }),
          result('Skill "no-ai-slop" loaded inline. Follow its instructions.'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('no-ai-slop');
    expect(out).toContain('loaded');
    expect(isGenericToolResult('Skill')).toBe(false);
  });

  it('Memory glance lists subjects for search results', () => {
    const renderer = pickResultRenderer('Memory');
    const out = strip(
      joinRender(
        renderer(
          call('Memory', { search: { query: 'prefs' } }),
          result('1. score=0.91 [m1] semantic/user\nSubject: Theme\nContent: dark\n\n2. score=0.80 [m2] semantic/user\nSubject: Lang\nContent: ko'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('search');
    expect(out).toContain('Theme');
    expect(out).toContain('Lang');
    expect(isGenericToolResult('Memory')).toBe(false);
  });
  it('NextPhase glance shows phase transition', () => {
    const renderer = pickResultRenderer('NextPhase');
    const out = strip(
      joinRender(
        renderer(
          call('NextPhase', { phase: 'interview' }),
          result('Advanced from research phase to interview phase.\n\nInterview Phase: expert leader'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('research → interview');
    expect(isGenericToolResult('NextPhase')).toBe(false);
  });

  it('GetCurrentTime glance shows local time and timezone', () => {
    const renderer = pickResultRenderer('GetCurrentTime');
    const out = strip(
      joinRender(
        renderer(
          call('GetCurrentTime', {}),
          result(
            JSON.stringify(
              { iso: '2026-07-07T14:51:00.000+09:00', local: '2026-07-07 14:51:00', timezone: 'Asia/Seoul' },
              null,
              2,
            ),
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('2026-07-07 14:51:00');
    expect(out).toContain('Asia/Seoul');
    expect(isGenericToolResult('GetCurrentTime')).toBe(false);
  });
  it('AskUserQuestion glance lists answers', () => {
    const renderer = pickResultRenderer('AskUserQuestion');
    const out = strip(
      joinRender(
        renderer(call('AskUserQuestion', {}), result(JSON.stringify({ answers: { theme: 'dark', lang: 'ko' } })), ctx),
      ),
    );
    expect(out).toContain('theme=dark');
    expect(out).toContain('lang=ko');
    expect(isGenericToolResult('AskUserQuestion')).toBe(false);
  });

  it('LioraReview glance samples findings', () => {
    const renderer = pickResultRenderer('LioraReview');
    const out = strip(
      joinRender(
        renderer(
          call('LioraReview', {}),
          result(
            '# Code Review Report\nFiles reviewed: 2\n\n## Findings\n- **WARNING** `a.ts:10` — empty catch\n- **SUGGESTION** `b.ts:2` — TODO\n',
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('2 files');
    expect(out).toContain('WARNING');
    expect(out).toContain('a.ts:10');
    expect(isGenericToolResult('LioraReview')).toBe(false);
  });
  it('TaskList glance shows task count', () => {
    const renderer = pickResultRenderer('TaskList');
    const out = strip(
      joinRender(renderer(call('TaskList', {}), result('active_background_tasks: 0\nNo background tasks found.'), ctx)),
    );
    expect(out).toContain('no background tasks');
    expect(isGenericToolResult('TaskList')).toBe(false);
  });

  it('TaskOutput glance shows id status and path', () => {
    const renderer = pickResultRenderer('TaskOutput');
    const out = strip(
      joinRender(
        renderer(
          call('TaskOutput', { task_id: 'bash-1' }),
          result('task_id: bash-1\nstatus: completed\noutput_path: /tmp/out.log'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('bash-1');
    expect(out).toContain('completed');
    expect(out).toContain('/tmp/out.log');
    expect(isGenericToolResult('TaskOutput')).toBe(false);
  });
  it('CronList glance shows job count', () => {
    const renderer = pickResultRenderer('CronList');
    const out = strip(
      joinRender(renderer(call('CronList', {}), result('cron_jobs: 0\nNo cron jobs scheduled.'), ctx)),
    );
    expect(out).toContain('no cron jobs');
    expect(isGenericToolResult('CronList')).toBe(false);
  });

  it('CronCreate glance shows id cron and next fire', () => {
    const renderer = pickResultRenderer('CronCreate');
    const out = strip(
      joinRender(
        renderer(
          call('CronCreate', { cron: '0 9 * * *' }),
          result('id: abcd1234\ncron: 0 9 * * *\nhumanSchedule: At 09:00\nrecurring: true\nnextFireAt: 2026-07-16T09:00:00+09:00'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('abcd1234');
    expect(out).toContain('0 9 * * *');
    expect(out).toContain('next ');
    expect(isGenericToolResult('CronCreate')).toBe(false);
  });
  it('UltraworkGraph glance samples node statuses', () => {
    const renderer = pickResultRenderer('UltraworkGraph');
    const out = strip(
      joinRender(
        renderer(
          call('UltraworkGraph', {}),
          result('Ultrawork graph g1 for run-1:\n  [running] n1: Scaffold\n  [pending] n2: Tests'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('running n1');
    expect(out).toContain('pending n2');
    expect(isGenericToolResult('UltraworkGraph')).toBe(false);
  });

  it('SwarmChannel glance shows posted channel/kind', () => {
    const renderer = pickResultRenderer('SwarmChannel');
    const out = strip(
      joinRender(
        renderer(
          call('SwarmChannel', { action: 'post' }),
          result('Posted to Swarm bus.\nid=m1\nchannel=standup\nkind=status'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('posted');
    expect(out).toContain('standup');
    expect(out).toContain('status');
    expect(isGenericToolResult('SwarmChannel')).toBe(false);
  });
  it('Agent glance shows type status and id', () => {
    const renderer = pickResultRenderer('Agent');
    const out = strip(
      joinRender(
        renderer(
          call('Agent', { description: 'explore' }),
          result('agent_id: a1\nactual_subagent_type: explore\nstatus: completed\n\n[summary]\nok'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('explore');
    expect(out).toContain('completed');
    expect(out).toContain('a1');
    expect(isGenericToolResult('Agent')).toBe(false);
  });

  it('UltraSwarm glance shows strategy and summary', () => {
    const renderer = pickResultRenderer('UltraSwarm');
    const out = strip(
      joinRender(
        renderer(
          call('UltraSwarm', {}),
          result(
            '<ultra_swarm_result run_id="r1">\n<strategy>auto_select</strategy>\n<summary>completed: 2, failed: 0, aborted: 0</summary>\n</ultra_swarm_result>',
          ),
          ctx,
        ),
      ),
    );
    expect(out).toContain('auto_select');
    expect(out).toContain('completed: 2');
    expect(isGenericToolResult('UltraSwarm')).toBe(false);
  });
  it('BrowserStatus glance shows host and title', () => {
    const renderer = pickResultRenderer('BrowserStatus');
    const out = strip(
      joinRender(
        renderer(
          call('BrowserStatus', {}),
          result(JSON.stringify({ ok: true, url: 'https://example.com/app', title: 'Demo App' }, null, 2)),
          ctx,
        ),
      ),
    );
    expect(out).toContain('example.com');
    expect(out).toContain('Demo App');
    expect(isGenericToolResult('BrowserStatus')).toBe(false);
  });

  it('ComputerCapture glance shows mode app and window title', () => {
    const renderer = pickResultRenderer('ComputerCapture');
    const out = strip(
      joinRender(
        renderer(
          call('ComputerCapture', { mode: 'som' }),
          result(JSON.stringify({ ok: true, mode: 'som', app: 'Safari', windowTitle: 'Home' }, null, 2)),
          ctx,
        ),
      ),
    );
    expect(out).toContain('som');
    expect(out).toContain('Safari');
    expect(out).toContain('Home');
    expect(isGenericToolResult('ComputerCapture')).toBe(false);
  });
  it('TodoList glance samples statuses and titles', () => {
    const renderer = pickResultRenderer('TodoList');
    const out = strip(
      joinRender(
        renderer(
          call('TodoList', {}),
          result('Current todo list:\n  [in_progress] Wire chips\n  [pending] Write tests\n  [done] Plan'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('in_progress: Wire chips');
    expect(out).toContain('pending: Write tests');
    expect(isGenericToolResult('TodoList')).toBe(false);
  });













  it('Grep glance lists path samples below the chip', () => {
    const renderer = pickResultRenderer('Grep');
    const out = strip(
      joinRender(
        renderer(
          call('Grep', { pattern: 'foo' }),
          result('src/a.ts\nsrc/b.ts\nsrc/c.ts\nsrc/d.ts\nsrc/e.ts'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
    expect(out).toContain('src/c.ts');
    expect(out).toContain('+2 more');
    expect(out).not.toContain('src/d.ts');
  });

  it('Grep glance strips trailing :line:text in content mode', () => {
    const renderer = pickResultRenderer('Grep');
    const out = strip(
      joinRender(
        renderer(
          call('Grep', { pattern: 'foo' }),
          result('src/a.ts:42:    foo()\nsrc/b.ts:7:foo'),
          ctx,
        ),
      ),
    );
    expect(out).toContain('src/a.ts:42');
    expect(out).not.toContain('foo()');
  });

  it('Grep with empty result renders nothing in collapsed state', () => {
    const renderer = pickResultRenderer('Grep');
    const out = joinRender(renderer(call('Grep', { pattern: 'foo' }), result(''), ctx));
    expect(out.trim()).toBe('');
  });

  it('Glob glance lists path samples', () => {
    const renderer = pickResultRenderer('Glob');
    const out = strip(
      joinRender(
        renderer(call('Glob', { pattern: '**/*.ts' }), result('a.ts\nb.ts\nc.ts\nd.ts'), ctx),
      ),
    );
    expect(out).toContain('a.ts');
    expect(out).toContain('b.ts');
    expect(out).toContain('c.ts');
    expect(out).toContain('+1 more');
  });

  it('FetchURL glance shows host and content preview when collapsed', () => {
    const renderer = pickResultRenderer('FetchURL');
    const out = strip(
      joinRender(
        renderer(call('FetchURL', { url: 'https://example.com/x' }), result('<body>hello world'), ctx),
      ),
    );
    expect(out).toContain('example.com');
    expect(out).toContain('hello');
  });

  it('WebSearch renders no body when collapsed', () => {
    const renderer = pickResultRenderer('WebSearch');
    const out = joinRender(
      renderer(call('WebSearch', { query: 'kimi' }), result('1. Alpha\n2. Beta'), ctx),
    );
    expect(out.trim()).toBe('');
  });

  it('Edit renders no body when collapsed', () => {
    const renderer = pickResultRenderer('Edit');
    const out = joinRender(
      renderer(
        call('Edit', { path: 'foo.ts', old_string: 'a', new_string: 'b' }),
        result('Replaced 1 occurrence in foo.ts'),
        ctx,
      ),
    );
    expect(out.trim()).toBe('');
  });

  it('Write renders no body when collapsed', () => {
    const renderer = pickResultRenderer('Write');
    const out = joinRender(
      renderer(call('Write', { path: 'a.txt', content: 'a\nb\n' }), result('Wrote'), ctx),
    );
    expect(out.trim()).toBe('');
  });

  it('Think renders no body even with a thought arg', () => {
    const renderer = pickResultRenderer('Think');
    const out = joinRender(renderer(call('Think', { thought: 'hello' }), result('Recorded.'), ctx));
    expect(out.trim()).toBe('');
  });

  it('GetGoal renders a compact goal summary instead of raw JSON', () => {
    const renderer = pickResultRenderer('GetGoal');
    const out = strip(joinRender(renderer(call('GetGoal'), result(goalOutput()), ctx)));
    expect(out).toContain('Goal active: Ship feature X');
    expect(out).toContain('2 turns');
    expect(out).toContain('1.2K tokens');
    expect(out).toContain('1m 01s');
    expect(out).not.toContain('"objective"');
    expect(out).not.toContain('"budget"');
  });

  it('GetGoal renders an empty goal without dumping JSON', () => {
    const renderer = pickResultRenderer('GetGoal');
    const out = strip(joinRender(renderer(call('GetGoal'), result('{"goal":null}'), ctx)));
    expect(out).toContain('No current goal.');
    expect(out).not.toContain('"goal"');
  });

  it('CreateGoal renders the created goal summary without raw JSON', () => {
    const renderer = pickResultRenderer('CreateGoal');
    const out = strip(joinRender(renderer(
      call('CreateGoal', { objective: 'Ship feature X' }),
      result(goalOutput()),
      ctx,
    )));
    expect(out).toContain('Goal active: Ship feature X');
    expect(out).not.toContain('"goalId"');
  });

  it('UpdateGoal success renders no redundant body', () => {
    const renderer = pickResultRenderer('UpdateGoal');
    const out = joinRender(
      renderer(call('UpdateGoal', { status: 'complete' }), result('Goal marked complete.'), ctx),
    );
    expect(out.trim()).toBe('');
  });

  it('Errors always fall back to truncated renderer regardless of tool', () => {
    const renderer = pickResultRenderer('Read');
    const out = strip(
      joinRender(
        renderer(call('Read', { path: 'foo.ts' }), result('ENOENT: foo.ts not found', true), ctx),
      ),
    );
    expect(out).toContain('ENOENT: foo.ts not found');
  });

  it('flags only fallback (truncated) tools as generic results', () => {
    expect(isGenericToolResult('SomethingUnknown')).toBe(true);
    expect(isGenericToolResult('mcp__server__do')).toBe(true);
    expect(isGenericToolResult('Bash')).toBe(false);
    expect(isGenericToolResult('Read')).toBe(false);
    expect(isGenericToolResult('Grep')).toBe(false);
    expect(isGenericToolResult('Edit')).toBe(false);
  });

  it('truncates unknown tool output by wrapped visual lines, not raw newlines', () => {
    const renderer = pickResultRenderer('SomethingUnknown');
    const longLine = 'x'.repeat(500);
    const out = strip(joinRender(renderer(call('SomethingUnknown'), result(longLine), ctx), 20));
    expect(out).toContain('x');
    expect(out).not.toContain(longLine);
    expect(out).toContain('... (');
  });
});
