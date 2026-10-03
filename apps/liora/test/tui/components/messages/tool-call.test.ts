import { visibleWidth, type RendererRootUI } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import { darkColors, neonNoirColors } from '#/tui/theme/colors';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  SETTLE_FLASH_MS,
} from '#/tui/features/appearance/appearance-effects';

import { setActiveTranscriptDetail } from '#/tui/features/transcript/transcript-density';


const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);

function strip(text: string): string {
  return text
    .replaceAll(/\u001B\[[0-9;]*m/g, '')
    .replaceAll(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, 'g'), '');
}

function stubTui(rows: number): RendererRootUI {
  return {
    terminal: { rows },
    requestRender: () => {},
  } as unknown as RendererRootUI;
}

describe('ToolCallComponent', () => {
  beforeEach(() => {
    currentTheme.setPalette(darkColors);
    setActiveTranscriptDetail('standard');
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
  });

  afterEach(() => {
    setActiveTranscriptDetail('standard');
    vi.useRealTimers();
    currentTheme.setPalette(neonNoirColors);
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('uses the shared non-emoji tool status bullet', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_read_marker',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
      },
      {
        tool_call_id: 'call_read_marker',
        output: 'content',
        is_error: false,
      },
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain(`${STATUS_BULLET}Used Bash`);
    expect(out).not.toContain(`\u23FA Used Bash`);
    expect(out).not.toContain(`${String.fromCodePoint(0x23fa, 0xfe0e)} Used Bash`);
  });
  it('appends elapsed duration to finished tool header chips', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));

    const component = new ToolCallComponent(
      {
        id: 'call_read_duration',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
        streamingStartedAtMs: Date.now() - 3_500,
      },
      {
        tool_call_id: 'call_read_duration',
        output: 'line1\nline2',
        is_error: false,
      },
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Used Bash');
    expect(out).toContain('line2');
    expect(out).toContain('3s');
  });

  it('shows live elapsed duration on long-running unfinished tools', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T00:00:00Z'));

    const component = new ToolCallComponent(
      {
        id: 'call_bash_duration',
        name: 'Bash',
        args: { command: 'sleep 30' },
        streamingStartedAtMs: Date.now() - 4_200,
      },
      undefined,
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Using Bash');
    expect(out).toContain('4s');
  });

  it('renders compact density as a quiet activity title without Used/Using', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const component = new ToolCallComponent(
      {
        id: 'call_read_compact',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
      },
      {
        tool_call_id: 'call_read_compact',
        output: 'line1\nline2',
        is_error: false,
      },
    );
    component.setDetail('compact');

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Ran');
    expect(out).toContain('foo.ts');
    expect(out).not.toContain('line1');
    expect(out).not.toContain('Used Bash');
    expect(out).not.toContain('Using Bash');
  });

  it('keeps live compact activity headers at a stable row count across entrance ticks', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    try {
      const component = new ToolCallComponent(
        {
          id: 'call_read_compact_live',
          name: 'Bash',
          args: { command: 'cat packages/agent-core/src/tools/builtin/job/windows-job.ts' },
          streamingStartedAtMs: Date.now() - 12_000,
        },
        undefined,
      );
      component.setDetail('compact');
      const rowCounts = new Set<number>();
      for (let t = 0; t < 800; t += 40) {
        advanceAppearanceAnimationClock(t);
        component.invalidate();
        rowCounts.add(component.render(40).length);
      }
      expect(rowCounts.size).toBe(1);
      expect([...rowCounts][0]).toBeGreaterThan(1);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    }
  });


  it('shows motion phase chips on generic tool headers', () => {
    const running = new ToolCallComponent(
      {
        id: 'call_generic_run',
        name: 'HistoricalTool',
        args: {},
      },
      undefined,
    );
    const runningOut = strip(running.render(100).join('\n'));
    expect(runningOut).toMatch(/[▸▹]/);
    expect(runningOut).toContain('HistoricalTool');
    expect(runningOut).not.toContain('❯');

    const done = new ToolCallComponent(
      {
        id: 'call_generic_done',
        name: 'SomethingUnknown',
        args: {},
      },
      {
        tool_call_id: 'call_generic_done',
        output: 'ok',
        is_error: false,
      },
    );
    const doneOut = strip(done.render(100).join('\n'));
    expect(doneOut).toContain('✓');
    expect(doneOut).toContain('SomethingUnknown');
    expect(doneOut).not.toContain('❯');
  });

  describe('detach hint for long-running foreground Bash', () => {
    it('shows the Ctrl+B hint after 6s for a running Bash call', () => {
      vi.useFakeTimers();
      const component = new ToolCallComponent(
        { id: 'call_bash_long', name: 'Bash', args: { command: 'sleep 30' } },
        undefined,
        stubTui(30),
      );

      expect(strip(component.render(100).join('\n'))).not.toContain(
        'Press Ctrl+B to background this task · /jobs bg to inspect',
      );

      vi.advanceTimersByTime(6_000);
      expect(strip(component.render(100).join('\n'))).toContain(
        'Press Ctrl+B to background this task · /jobs bg to inspect',
      );

      component.dispose();
    });

    

    it('does not show the hint for non-detachable tools', () => {
      vi.useFakeTimers();
      const component = new ToolCallComponent(
        { id: 'call_session_list', name: 'SessionControl', args: { operation: 'list' } },
        undefined,
        stubTui(30),
      );

      vi.advanceTimersByTime(15_000);
      expect(strip(component.render(100).join('\n'))).not.toContain(
        'Press Ctrl+B to background this task · /jobs bg to inspect',
      );

      component.dispose();
    });

    it('does not show the hint when the result lands before 6s', () => {
      vi.useFakeTimers();
      const component = new ToolCallComponent(
        { id: 'call_bash_short', name: 'Bash', args: { command: 'echo hi' } },
        undefined,
        stubTui(30),
      );

      vi.advanceTimersByTime(5_000);
      component.setResult({ tool_call_id: 'call_bash_short', output: 'hi', is_error: false });
      vi.advanceTimersByTime(6_000);

      expect(strip(component.render(100).join('\n'))).not.toContain(
        'Press Ctrl+B to background this task · /jobs bg to inspect',
      );

      component.dispose();
    });
  });

  it('keeps collapsed tool-call lines within very narrow widths', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_narrow_read',
        name: 'Bash',
        args: { command: 'cat very/long/path/to/foo.ts' },
      },
      {
        tool_call_id: 'call_narrow_read',
        output: 'content',
        is_error: false,
      },
    );

    for (const width of [1, 2, 4, 10, 39]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('keeps collapsed tool results short and expands on demand', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_shell',
        name: 'Bash',
        args: { command: 'printf output' },
      },
      {
        tool_call_id: 'call_shell',
        output: ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n'),
        is_error: false,
      },
    );

    const collapsed = strip(component.render(100).join('\n'));
    // Standard detail level: the `$ printf output` command row plus the first
    // 4 output lines fill the 5-line viewport; line5+ waits for ctrl+o.
    expect(collapsed).toContain('line1');
    expect(collapsed).toContain('line4');
    expect(collapsed).not.toContain('line5');
    expect(collapsed).not.toContain('⋯ 2 more lines — scroll for more');

    component.setExpanded(true);

    const expanded = strip(component.render(100).join('\n'));
    expect(expanded).toContain('line5');
    expect(expanded).toContain('line7');
    expect(expanded).not.toContain('ctrl+o to expand');
  });

  it('renders live Bash output while the command is running', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_shell_live',
        name: 'Bash',
        args: { command: 'printf output' },
      },
      undefined,
    );

    component.appendLiveOutput('line1\n');
    component.appendLiveOutput('line2\n');

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Using Bash');
    // Live bash shows a short tail of streaming output (RESULT_PREVIEW_LINES=5).
    expect(out).toContain('line1');
    expect(out).toContain('line2');
  });

  it('clears live Bash output when the final result arrives', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_shell_live_done',
        name: 'Bash',
        args: { command: 'printf output' },
      },
      undefined,
    );

    component.appendLiveOutput('streamed-only\n');
    component.setResult({
      tool_call_id: 'call_shell_live_done',
      output: 'final-only\n',
      is_error: false,
    });

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Used Bash');
    expect(out).toContain('final-only');
    expect(out).not.toContain('streamed-only');
  });

  describe('in-flight Bash command preview (args finalized, no result yet)', () => {
    const longCommand = Array.from({ length: 15 }, (_, i) => `echo step${String(i + 1)}`).join(
      '\n',
    );

    it('shows the truncated command while running and reveals the rest when expanded', () => {
      const component = new ToolCallComponent(
        { id: 'call_bash_running', name: 'Bash', args: { command: longCommand } },
        undefined,
      );

      const collapsed = strip(component.render(100).join('\n'));
      expect(collapsed).toContain('Using Bash');
      expect(collapsed).toContain('echo step1');
      expect(collapsed).toContain('echo step4');
      expect(collapsed).not.toContain('echo step5');

      component.setExpanded(true);

      const expanded = strip(component.render(100).join('\n'));
      expect(expanded).toContain('echo step11');
      expect(expanded).toContain('echo step15');
    });

    it('yields command rendering to the result renderer once the result lands', () => {
      const component = new ToolCallComponent(
        { id: 'call_bash_done', name: 'Bash', args: { command: longCommand } },
        undefined,
      );

      // Sanity: while running, the in-flight preview shows the command.
      expect(strip(component.render(100).join('\n'))).toContain('$ echo step1');

      component.setResult({ tool_call_id: 'call_bash_done', output: 'done', is_error: false });

      // The result renderer (bashResultSummary) now owns command visibility:
      // the command renders exactly once — the in-flight preview must be gone,
      // otherwise the command would render twice when expanded.
      const out = strip(component.render(100).join('\n'));
      expect(out).toContain('Used Bash');
      expect(out.match(/\$ echo step1/g)?.length ?? 0).toBe(1);
    });
  });

  it('preserves Bash output bodies that start with a <system tag', () => {
    const rawOutput = '<system-reminder>\nraw command output\n</system-reminder>';
    const component = new ToolCallComponent(
      {
        id: 'call_raw',
        name: 'Bash',
        args: { command: 'echo hi' },
      },
      {
        tool_call_id: 'call_raw',
        output: rawOutput,
        is_error: false,
      },
    );

    const collapsed = strip(component.render(100).join('\n'));
    expect(collapsed).toContain(`${STATUS_BULLET}Used Bash`);
    expect(collapsed).toContain('<system-reminder>');
    expect(collapsed).toContain('raw command output');
    expect(collapsed).toContain('</system-reminder>');

    component.setExpanded(true);
    const expanded = strip(component.render(100).join('\n'));
    expect(expanded).toContain('<system-reminder>');
    expect(expanded).toContain('raw command output');
    expect(expanded).toContain('</system-reminder>');
  });

  it('preserves <system-prefixed Bash output even when the result is an error', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_raw_err',
        name: 'Bash',
        args: { command: 'false' },
      },
      {
        tool_call_id: 'call_raw_err',
        output: '<system-reminder>raw error output</system-reminder>',
        is_error: true,
      },
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('<system-reminder>raw error output</system-reminder>');
    expect(out).toContain('✗');
    component.setExpanded(true);
    expect(strip(component.render(100).join('\n'))).toContain(
      '<system-reminder>raw error output</system-reminder>',
    );
  });

  it('preserves Bash output that contains <system later on', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_inline',
        name: 'Bash',
        args: { command: 'echo hi' },
      },
      {
        tool_call_id: 'call_inline',
        output: 'first line\n<system-reminder>nope</system-reminder>',
        is_error: false,
      },
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('first line');
    expect(out).toContain('<system-reminder>nope</system-reminder>');
  });

  it('appends an elapsed chip to the header once a result arrives', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000);
    const component = new ToolCallComponent(
      {
        id: 'call_read',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
        streamingStartedAtMs: 0,
      },
      {
        tool_call_id: 'call_read',
        output: '1\tfoo\n2\tbar\n3\tbaz',
        is_error: false,
      },
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Used Bash');
    expect(out).toContain('· 3s');
  });

  it('keeps failed completed tools in the completed header grammar', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_read_error',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
      },
      {
        tool_call_id: 'call_read_error',
        output: 'permission denied',
        is_error: true,
      },
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Used Bash');
    expect(out).not.toContain('Using Bash');
  });


  it('does not append a chip while a tool is still running', () => {
    const component = new ToolCallComponent(
      {
        id: 'call_pending',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
      },
      undefined,
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Using Bash');
    expect(out).not.toContain('lines');
  });

  it('renders a single foreground subagent without the generic Agent tool header', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const component = new ToolCallComponent(
      {
        id: 'call_agent',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'explore project xxx', prompt: 'explore project xxx' },
      },
      undefined,
    );

    component.onSubagentSpawned({
      agentId: 'sub_explore_123456',
      agentName: 'explore',
      runInBackground: false,
    });

    let out = strip(component.render(120).join('\n'));
    expect(out).toContain('Explore Agent Queued (explore project xxx) · 0 tools · 0s');
    expect(out).not.toContain('Using Agent');
    expect(out).not.toContain('Used Agent');

    vi.setSystemTime(20_000);
    component.appendSubagentText('think1\nthink2\nthink3', 'thinking');
    component.appendSubagentText('answer1\nanswer2\nanswer3', 'text');
    component.appendSubToolCall({
      id: 'sub_explore_123456:read',
      name: 'Bash',
      args: { command: 'cat src/background-agent-status.ts' },
    });

    out = strip(component.render(120).join('\n'));
    expect(out).toContain('Explore Agent Running (explore project xxx) · 1 tool · 10s');
    expect(out).toContain('Using Bash (cat src/background-agent-status.ts)');
    // Live subagent thinking uses THINKING_PREVIEW_LINES (4) tail glance.
    expect(out).toContain('think1');
    expect(out).toContain('think2');
    expect(out).toContain('think3');
    expect(out).toContain('◌ think1');
    expect(out).not.toContain('answer1');
    expect(out).not.toContain('answer2');
    expect(out).toContain('answer3');
    expect(out).toContain('└ answer3');

    vi.setSystemTime(22_000);
    component.onSubagentCompleted({ resultSummary: 'summary fallback' });
    component.setResult({
      tool_call_id: 'call_agent',
      output: 'parent duplicate result',
      is_error: false,
    });
    vi.setSystemTime(30_000);

    out = strip(component.render(120).join('\n'));
    expect(out).toContain('Explore Agent Completed (explore project xxx) · 1 tool · 12s');
    expect(out).not.toContain('think3');
    expect(out).toContain('└ answer3');
    expect(out).not.toContain('Used Agent');
    expect(out).not.toContain('parent duplicate result');
    expect(out).not.toContain('summary fallback');
  });

  it('shows Backgrounded after a foreground subagent is detached, even after setResult', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_detach',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'long task', prompt: 'long task' },
      },
      undefined,
      stubTui(30),
    );
    component.onSubagentSpawned({
      agentId: 'sub_detach_1',
      agentName: 'explore',
      runInBackground: false,
    });
    component.onSubagentStarted({
      agentId: 'sub_detach_1',
      agentName: 'explore',
      runInBackground: false,
    });

    // Sanity: running before detach.
    expect(strip(component.render(120).join('\n'))).toContain('Running');

    component.markBackgrounded();
    let out = strip(component.render(120).join('\n'));
    expect(out).toContain('Backgrounded');
    expect(out).not.toContain('Completed');

    // The spawn-success ToolResult landing must NOT flip the card to Completed.
    component.setResult({
      tool_call_id: 'call_agent_detach',
      output: JSON.stringify({ agentId: 'sub_detach_1', taskId: 'task_detach_1', status: 'running' }),
      is_error: false,
    });
    out = strip(component.render(120).join('\n'));
    expect(out).toContain('Backgrounded');
    expect(out).not.toContain('Completed');

    component.dispose();
  });

  it('keeps the single subagent tool area to the latest four activities', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_tools',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'inspect tools', prompt: 'inspect tools' },
      },
      undefined,
    );
    component.onSubagentSpawned({
      agentId: 'sub_tools',
      agentName: 'explore',
      runInBackground: false,
    });

    for (let i = 1; i <= 4; i++) {
      const id = `sub_tools:read-${String(i)}`;
      component.appendSubToolCall({ id, name: 'Bash', args: { command: 'cat ' + `file${String(i)}.ts` } });
      component.finishSubToolCall({ tool_call_id: id, output: 'ok', is_error: false });
    }
    component.appendSubToolCall({
      id: 'sub_tools:grep',
      name: 'Bash',
      args: { command: 'rg auth' },
    });

    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Explore Agent Running (inspect tools) · 5 tools · 0s');
    expect(out).not.toContain('file1.ts');
    expect(out).toContain('Used Bash (cat file2.ts)');
    expect(out).toContain('Used Bash (cat file3.ts)');
    expect(out).toContain('Used Bash (cat file4.ts)');
    expect(out).not.toContain('… Using Bash (rg auth)');
    expect(out).toContain('• Using Bash (rg auth)');
    expect(out).toContain('Using Bash (rg auth)');
  });

  it('keeps the single subagent tool window stable when older tools update', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_stable_tools',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'inspect tools', prompt: 'inspect tools' },
      },
      undefined,
    );
    component.onSubagentSpawned({
      agentId: 'sub_tools',
      agentName: 'explore',
      runInBackground: false,
    });

    for (let i = 1; i <= 5; i++) {
      component.appendSubToolCall({
        id: `sub_tools:read-${String(i)}`,
        name: 'Bash',
        args: { command: 'cat ' + `file${String(i)}.ts` },
      });
    }
    component.appendSubToolCallDelta({
      id: 'sub_tools:read-1',
      name: 'Bash',
      argumentsPart: '{"command":"cat file1-updated.ts"}',
    });
    component.finishSubToolCall({
      tool_call_id: 'sub_tools:read-1',
      output: 'ok',
      is_error: false,
    });

    const out = strip(component.render(120).join('\n'));
    expect(out).not.toContain('file1-updated.ts');
    expect(out).toContain('Using Bash (cat file2.ts)');
    expect(out).toContain('Using Bash (cat file3.ts)');
    expect(out).toContain('Using Bash (cat file4.ts)');
    expect(out).toContain('Using Bash (cat file5.ts)');
  });

  it('wraps single subagent thinking and output with hanging indentation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_wrapped_text',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'inspect wrapping', prompt: 'inspect wrapping' },
      },
      undefined,
    );
    component.onSubagentSpawned({
      agentId: 'sub_wrapped',
      agentName: 'explore',
      runInBackground: false,
    });
    component.appendSubagentText(
      'thinking words that should wrap with a clean hanging indent',
      'thinking',
    );
    component.appendSubagentText(
      'output words that should also wrap with a clean hanging indent',
      'text',
    );

    const lines = strip(component.render(34).join('\n')).split('\n');
    // Thinking is scrolled to its last THINKING_PREVIEW_LINES display rows, so
    // the head of the wrapped paragraph drops and the ◌ marker hangs on a kept row.
    expect(lines.some((l) => l.includes('◌'))).toBe(true);
    expect(lines.join('\n')).toMatch(/wrap with a clean hanging|hanging indent/);
    // Rows carry the ▌ strip marker; match the wrapped content inside rows.
    expect(lines.some((l) => l.includes('indent'))).toBe(true);
    // Output keeps its full hanging-indent wrap (unchanged behavior).
    expect(lines.some((l) => l.includes('└ output words that should also'))).toBe(true);
    expect(lines.some((l) => l.includes('wrap with a clean hanging'))).toBe(true);
  });

  it('scrolls single subagent thinking to the last THINKING_PREVIEW_LINES display rows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_scroll',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'long think', prompt: 'long think' },
      },
      undefined,
    );
    component.onSubagentSpawned({
      agentId: 'sub_scroll',
      agentName: 'explore',
      runInBackground: false,
    });
    // A single long logical line (no newlines) wraps to many display rows;
    // only the last THINKING_PREVIEW_LINES (4) should remain visible.
    // Enough segments to wrap past the preview window at width 40.
    const segs = Array.from({ length: 60 }, (_, i) => `seg${String(i).padStart(2, '0')}`);
    component.appendSubagentText(segs.join(' '), 'thinking');

    const lines = strip(component.render(40).join('\n')).split('\n');
    const thinkingRows = lines.filter((l) => /seg\d\d/.test(l));
    expect(thinkingRows.length).toBe(4);
    expect(lines.join('\n')).toContain('seg59');
    expect(lines.join('\n')).not.toContain('seg00');
  });

  it('shows and truncates a single subagent Bash tool output', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_bash_out',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'run bash', prompt: 'run bash' },
      },
      undefined,
    );
    component.onSubagentSpawned({
      agentId: 'sub_bash',
      agentName: 'explore',
      runInBackground: false,
    });
    component.appendSubToolCall({
      id: 'sub_bash:cmd',
      name: 'Bash',
      args: { command: 'ls -la' },
    });
    const output = Array.from({ length: 10 }, (_, i) => `bash-line-${String(i)}`).join('\n');
    component.finishSubToolCall({ tool_call_id: 'sub_bash:cmd', output, is_error: false });

    let out = strip(component.render(120).join('\n'));
    expect(out).toContain('Used Bash (ls -la)');
    expect(out).toContain('bash-line-0');
    expect(out).toContain('bash-line-4');
    expect(out).not.toContain('bash-line-5');
    expect(out).toContain('... (5 more lines)');
    // Subagent output is fixed-truncated: no ctrl+o promise.
    expect(out).not.toContain('ctrl+o');

    // The global ctrl+o expand toggle must NOT expand subagent output.
    component.setExpanded(true);
    out = strip(component.render(120).join('\n'));
    expect(out).not.toContain('bash-line-9');
    expect(out).toContain('... (5 more lines)');
  });

  it('truncates unknown subagent tool output but leaves recognized tools as rows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_mixed',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'mixed tools', prompt: 'mixed tools' },
      },
      undefined,
    );
    component.onSubagentSpawned({
      agentId: 'sub_mixed',
      agentName: 'explore',
      runInBackground: false,
    });
    component.appendSubToolCall({
      id: 'sub_mixed:read',
      name: 'SessionControl',
      args: { operation: 'list' },
    });
    component.finishSubToolCall({
      tool_call_id: 'sub_mixed:read',
      output: 'recognized-session-body\nhidden-session-line',
      is_error: false,
    });
    component.appendSubToolCall({
      id: 'sub_mixed:mcp',
      name: 'HistoricalTool',
      args: {},
    });
    const mcpOut = Array.from({ length: 8 }, (_, i) => `mcp-line-${String(i)}`).join('\n');
    component.finishSubToolCall({ tool_call_id: 'sub_mixed:mcp', output: mcpOut, is_error: false });

    const out = strip(component.render(120).join('\n'));
    // Recognized tool: activity row only, no output body.
    expect(out).toContain('Used SessionControl (list)');
    expect(out).not.toContain('recognized-session-body');
    // Unknown historical tools retain a truncated body, no ctrl+o promise.
    expect(out).toContain('mcp-line-0');
    expect(out).toContain('mcp-line-4');
    expect(out).not.toContain('mcp-line-5');
    expect(out).toContain('... (3 more lines)');
    expect(out).not.toContain('ctrl+o');
  });

  it('renders failed single subagents with the dedicated header and error text', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const component = new ToolCallComponent(
      {
        id: 'call_agent_failed',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'check failure', prompt: 'check failure' },
      },
      undefined,
    );
    component.onSubagentSpawned({
      agentId: 'sub_failed',
      agentName: 'explore',
      runInBackground: false,
    });

    vi.setSystemTime(4000);
    component.onSubagentFailed({ error: 'subagent exceeded max_steps' });

    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Explore Agent Failed (check failure) · 0 tools · 3s');
    expect(out).toContain('└ subagent exceeded max_steps');
    expect(out).not.toContain('Using Agent');
    expect(out).not.toContain('Used Agent');
  });

  describe('background agent terminal state vs spawn-success ToolResult', () => {
    // SessionControl acknowledges spawning before the child finishes.
    // Actual child/background terminal events, not the ACK, determine completion.
    const spawnSuccessResult = {
      tool_call_id: 'call_bg_agent',
      output: JSON.stringify({ agentId: 'agent-0', taskId: 'agent-deadbeef', status: 'running' }),
      is_error: false,
    };

    function makeBackgroundAgentComponent(): ToolCallComponent {
      const component = new ToolCallComponent(
        {
          id: 'call_bg_agent',
          name: 'SessionControl',
          args: { operation: 'spawn', description: 'background agent 1', prompt: 'background agent 1' },
        },
        spawnSuccessResult,
      );
      component.onSubagentSpawned({
        agentId: 'agent-0',
        agentName: 'coder',
        runInBackground: true,
      });
      return component;
    }

    it('keeps a spawned child active rather than treating its ACK as completion', () => {
      const component = makeBackgroundAgentComponent();
      expect(component.getSubagentSnapshot().phase).toBe('backgrounded');
    });

    it('setBackgroundTaskTerminalStatus("lost") flips the snapshot phase to "failed"', () => {
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('lost');
      const snap = component.getSubagentSnapshot();
      expect(snap.phase).toBe('failed');
      // The agent-group renderer uses snap.errorText for the "Error:" line.
      // The spawn-success ToolResult must NOT leak as the failure message.
      expect(snap.errorText).toContain('lost');
      expect(snap.errorText).not.toContain('taskId');
    });

    it('setBackgroundTaskTerminalStatus("killed") flips the snapshot phase to "failed"', () => {
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('killed');
      const snap = component.getSubagentSnapshot();
      expect(snap.phase).toBe('failed');
      expect(snap.errorText).toContain('killed');
      expect(snap.errorText).not.toContain('taskId');
    });

    it('setBackgroundTaskTerminalStatus("failed") flips the snapshot phase to "failed"', () => {
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('failed');
      const snap = component.getSubagentSnapshot();
      expect(snap.phase).toBe('failed');
      expect(snap.errorText).toContain('failed');
      expect(snap.errorText).not.toContain('taskId');
    });

    it('setBackgroundTaskTerminalStatus("completed") keeps the snapshot phase at "done"', () => {
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('completed');
      const snap = component.getSubagentSnapshot();
      expect(snap.phase).toBe('done');
      expect(snap.errorText).toBeUndefined();
    });

    it('overrides win even when set before the spawn-success result is recorded', () => {
      // Order-independence guard: reconcile may run before tool result
      // has been replayed back into the component on some boot paths.
      const component = new ToolCallComponent(
        {
          id: 'call_bg_agent',
          name: 'SessionControl',
          args: { operation: 'spawn', description: 'background agent A', prompt: 'background agent A' },
        },
        undefined,
      );
      component.setBackgroundTaskTerminalStatus('lost');
      // Now the spawn-success result lands.
      component.setResult({ ...spawnSuccessResult, tool_call_id: 'call_bg_agent' });
      expect(component.getSubagentSnapshot().phase).toBe('failed');
    });

    // The standalone card must agree with the grouped/background terminal state.
    it('standalone render: lost bg agent must show Failed/Lost, not Completed', () => {
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('lost');
      const out = strip(component.render(120).join('\n'));
      expect(out).not.toContain('Completed');
      expect(out).toMatch(/Failed|Lost/);
      // Friendly failure message must reach the rendered card.
      expect(out).toContain('lost');
      expect(out).not.toContain('taskId');
    });

    it('standalone render: completed bg agent still shows Completed', () => {
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('completed');
      const out = strip(component.render(120).join('\n'));
      expect(out).toContain('Completed');
      expect(out).not.toMatch(/Failed/);
      expect(out).not.toContain('taskId');
    });

    it('getSubagentAgentId parses agentId from the spawn acknowledgement', () => {
      const component = new ToolCallComponent(
        {
          id: 'call_bg_agent',
          name: 'SessionControl',
          args: { operation: 'spawn', description: 'background agent 1', prompt: 'background agent 1' },
        },
        spawnSuccessResult,
      );
      // No spawn metadata was wired in — exactly the resume / backgrounded
      // case we are guarding against.
      expect(component.getSubagentAgentId()).toBe('agent-0');
    });

    it('getSubagentAgentId still prefers in-memory subagent metadata when set', () => {
      // If `setSubagentMeta` / `onSubagentSpawned` did wire an id, that one
      // is authoritative — it survived the in-flight phase before any
      // ToolResult landed and can disambiguate concurrent calls.
      const component = new ToolCallComponent(
        {
          id: 'call_bg_agent',
          name: 'SessionControl',
          args: { operation: 'spawn', description: 'X', prompt: 'X' },
        },
        spawnSuccessResult,
      );
      component.setSubagentMeta('agent-explicit', 'coder');
      expect(component.getSubagentAgentId()).toBe('agent-explicit');
    });

    it('getSubagentAgentId returns undefined for Bash even when output looks similar', () => {
      const component = new ToolCallComponent(
        {
          id: 'call_bash',
          name: 'Bash',
          args: { command: 'echo child acknowledgement' },
        },
        {
          tool_call_id: 'call_bash',
          output: JSON.stringify({ agentId: 'agent-fake', status: 'running' }),
          is_error: false,
        },
      );
      expect(component.getSubagentAgentId()).toBeUndefined();
    });

    it('setBackgroundTaskTerminalStatus errorText overwrites the friendly generic', () => {
      // Live failures arrive via `subagent.failed` with the real error from
      // the subagent loop. That string is far more informative than the
      // generic "Background agent failed" fallback the friendly path emits.
      // When the caller supplies errorText it must win, regardless of
      // whether the friendly message was written first.
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('failed');
      expect(component.getSubagentSnapshot().errorText).toBe('Background agent failed');

      component.setBackgroundTaskTerminalStatus('failed', {
        errorText: 'subagent exceeded max_steps',
      });
      expect(component.getSubagentSnapshot().errorText).toBe('subagent exceeded max_steps');
    });

    it('setBackgroundTaskTerminalStatus errorText is written even on first call', () => {
      const component = makeBackgroundAgentComponent();
      component.setBackgroundTaskTerminalStatus('failed', {
        errorText: 'OAuth refresh failed',
      });
      expect(component.getSubagentSnapshot().errorText).toBe('OAuth refresh failed');
    });

    it('setBackgroundTaskTerminalStatus does not overwrite a real onSubagentFailed error with the generic', () => {
      const component = makeBackgroundAgentComponent();
      component.onSubagentFailed({ error: 'real crash from subagent' });
      // background.task.terminated event arrives later without an errorText
      // override; the friendly generic must NOT clobber the real message.
      component.setBackgroundTaskTerminalStatus('failed');
      expect(component.getSubagentSnapshot().errorText).toBe('real crash from subagent');
    });
  });

  it('keeps child elapsed time and live output advancing after the spawn acknowledgement', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    advanceAppearanceAnimationClock(0);
    const component = new ToolCallComponent(
      {
        id: 'call_session_ack',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'inspect output', prompt: 'inspect output' },
      },
      undefined,
    );
    const child = { agentId: 'agent-ack', agentName: 'worker', runInBackground: false };
    component.onSubagentSpawned(child);
    component.onSubagentStarted(child);
    component.setResult({
      tool_call_id: 'call_session_ack',
      output: JSON.stringify({ agentId: child.agentId, taskId: 'task-ack', status: 'running' }),
      is_error: false,
    });

    vi.setSystemTime(2_000);
    advanceAppearanceAnimationClock(2_000);
    component.appendSubToolCall({
      id: 'sub_ack:bash',
      name: 'Bash',
      args: { command: 'printf progress' },
    });
    component.appendSubToolLiveOutput('sub_ack:bash', 'progress output\n');
    const running = strip(component.render(100).join('\n'));
    expect(running).toContain('Worker Agent Running');
    expect(running).toContain('2s');
    expect(running).toContain('Using Bash (printf progress)');
    expect(running).toContain('progress output');
    expect(running).not.toContain('Completed');
    expect(component.getSubagentSnapshot().phase).toBe('running');

    vi.setSystemTime(3_000);
    component.onSubagentCompleted({ resultSummary: 'inspection finished' });
    vi.setSystemTime(9_000);
    advanceAppearanceAnimationClock(9_000);
    const completed = strip(component.render(100).join('\n'));
    expect(completed).toContain('Worker Agent Completed');
    expect(completed).toContain('3s');
    expect(completed).not.toContain('9s');
    expect(component.getSubagentSnapshot().phase).toBe('done');
    component.dispose();
  });


  it('switches a streaming tool call to Truncated when the step ended with max_tokens', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 10; i++) lines.push(`line${String(i)}`);
    const escaped = lines.join('\\n');
    const component = new ToolCallComponent(
      {
        id: 'call_bash_truncated',
        name: 'Bash',
        args: {},
        streamingArguments: `{"command":"${escaped}`,
        truncated: true,
      },
      undefined,
    );

    const out = strip(component.render(100).join('\n'));
    expect(out).toContain('Truncated Bash');
    expect(out).not.toContain('Using Bash');
    expect(out).toContain('Tool call arguments truncated by max_tokens');
    // A truncated call must not keep displaying its half-streamed command.
    expect(out).not.toContain('line1');
    expect(out).not.toContain('line10');
  });


  it('refreshes and stops the Bash streaming progress clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    advanceAppearanceAnimationClock(0);
    const ui = { requestRender: vi.fn() };
    const component = new ToolCallComponent(
      {
        id: 'call_bash_timer',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
        streamingArguments: '{"command":"cat foo.ts',
        streamingStartedAtMs: 0,
      },
      undefined,
      ui as never,
    );

    expect(strip(component.render(100).join('\n'))).toContain('Using Bash');
    // The streaming-progress counter ticks off the shared appearance animation
    // clock (advanced once per frame by the native render loop) and rebuilds
    // during `render()`, so advance both clocks then render to drive the tick.
    ui.requestRender.mockClear();
    vi.advanceTimersByTime(1000);
    advanceAppearanceAnimationClock(1000);
    expect(strip(component.render(100).join('\n'))).toContain('1s');
    expect(ui.requestRender).toHaveBeenCalled();

    ui.requestRender.mockClear();
    component.setResult({
      tool_call_id: 'call_bash_timer',
      output: 'file content',
      is_error: false,
    });
    vi.advanceTimersByTime(1000);
    advanceAppearanceAnimationClock(1000);
    component.render(100);
    expect(ui.requestRender).not.toHaveBeenCalled();

    const componentToDispose = new ToolCallComponent(
      {
        id: 'call_bash_dispose',
        name: 'Bash',
        args: { command: 'cat bar.ts' },
        streamingArguments: '{"command":"cat bar.ts',
        streamingStartedAtMs: 0,
      },
      undefined,
      ui as never,
    );
    ui.requestRender.mockClear();
    componentToDispose.dispose();
    vi.advanceTimersByTime(1000);
    expect(ui.requestRender).not.toHaveBeenCalled();
  });

});

describe('ToolCallComponent motion cues', () => {
  const previousEnv = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };
  const previousChalkLevel = chalk.level;
  const premium = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium' as const,
    particles: 'premium' as const,
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    chalk.level = 3;
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences(premium);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    chalk.level = previousChalkLevel;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function headerLine(component: ToolCallComponent): string {
    const lines = component.render(100);
    const index = lines.findIndex(
      (line) => strip(line).includes('Using Bash') || strip(line).includes('Used Bash'),
    );
    return index >= 0 ? (lines[index] ?? '') : lines.join('\n');
  }

  it('header entrance highlight is active at t0 and expired after the window (premium)', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new ToolCallComponent(
      { id: 'call_entrance_premium', name: 'Bash', args: { command: 'cat foo.ts' } },
      undefined,
    );

    const t0 = headerLine(component);
    expect(strip(t0)).toContain('Using Bash');
    // The entrance blends dim arg runs toward a bold truecolor highlight —
    // a dim+bold+truecolor SGR only occurs while the settle is animating.
    expect(t0).toContain('\u001B[0;1;2;38;2');

    // Past both the header settle (280ms) and the block wash (560ms).
    vi.setSystemTime(new Date(start + 700));
    advanceAppearanceAnimationClock(Date.now());
    const settled = headerLine(component);
    expect(strip(settled)).toContain('Using Bash');
    expect(settled).not.toContain('\u001B[0;1;2;38;2');
  });

  it('result completion flashes the status mark, then settles to the success tone', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new ToolCallComponent(
      { id: 'call_settle_success', name: 'Bash', args: { command: 'cat foo.ts' } },
      undefined,
    );
    // Move past the entrance window so only the result flash animates.
    const settleAt = start + 700;
    vi.setSystemTime(new Date(settleAt));
    advanceAppearanceAnimationClock(settleAt);
    component.setResult({
      tool_call_id: 'call_settle_success',
      output: 'content',
      is_error: false,
    });

    const staticBullet = currentTheme.fg('success', STATUS_BULLET);
    const flashing = headerLine(component);
    expect(strip(flashing)).toContain('Used Bash');
    expect(flashing).not.toContain(staticBullet);

    vi.setSystemTime(new Date(settleAt + SETTLE_FLASH_MS + 60));
    advanceAppearanceAnimationClock(Date.now());
    const settled = headerLine(component);
    expect(strip(settled)).toContain('Used Bash');
    expect(settled).toContain(staticBullet);
  });

  it('error results settle to the error tone', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new ToolCallComponent(
      { id: 'call_settle_error', name: 'Bash', args: { command: 'cat foo.ts' } },
      undefined,
    );
    const settleAt = start + 700;
    vi.setSystemTime(new Date(settleAt));
    advanceAppearanceAnimationClock(settleAt);
    component.setResult({
      tool_call_id: 'call_settle_error',
      output: 'boom',
      is_error: true,
    });

    const staticBullet = currentTheme.fg('error', '✗ ');
    const flashing = headerLine(component);
    expect(strip(flashing)).toContain('Used Bash');
    expect(flashing).not.toContain(staticBullet);

    vi.setSystemTime(new Date(settleAt + SETTLE_FLASH_MS + 60));
    advanceAppearanceAnimationClock(Date.now());
    const settled = headerLine(component);
    expect(settled).toContain(staticBullet);
  });

  it('quality off keeps headers byte-stable (no entrance, no result flash)', () => {
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off' as const,
      particles: 'off' as const,
    });
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new ToolCallComponent(
      { id: 'call_motion_off', name: 'Bash', args: { command: 'cat foo.ts' } },
      undefined,
    );

    const t0 = component.render(100);
    vi.setSystemTime(new Date(start + 900));
    advanceAppearanceAnimationClock(Date.now());
    expect(component.render(100)).toEqual(t0);

    component.setResult({ tool_call_id: 'call_motion_off', output: 'x', is_error: false });
    const flashed = component.render(100);
    vi.setSystemTime(new Date(start + 1600));
    advanceAppearanceAnimationClock(Date.now());
    expect(component.render(100)).toEqual(flashed);
    expect(strip(flashed.join('\n'))).toContain(`${STATUS_BULLET}Used Bash`);
  });

  function agentLine(component: ToolCallComponent, needle: string): string {
    const lines = component.render(100);
    const index = lines.findIndex((line) => strip(line).includes(needle));
    return index >= 0 ? (lines[index] ?? '') : lines.join('\n');
  }

  it('subagent spawn entrance settles once on the single agent card (premium)', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new ToolCallComponent(
      {
        id: 'call_spawn_entrance_single',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'explore spawn motion', prompt: 'explore spawn motion' },
      },
      undefined,
    );
    // Pin the card's own mount entrance at mount time; it has settled by
    // the time the spawn arrives 700ms later.
    component.render(100);
    const spawnAt = start + 700;
    vi.setSystemTime(new Date(spawnAt));
    advanceAppearanceAnimationClock(spawnAt);
    component.onSubagentSpawned({
      agentId: 'sub_spawn_single',
      agentName: 'explore',
      runInBackground: false,
    });

    const t0 = agentLine(component, 'Explore Agent');
    expect(strip(t0)).toContain('Explore Agent Queued');
    // The spawn settle blends dim chip runs toward a bold truecolor
    // highlight — the dim+bold+truecolor SGR only occurs while animating.
    expect(t0).toContain('\u001B[0;1;2;38;2');

    // Past the 280ms settle the highlight is gone — and re-renders at later
    // clocks never restart it (first-seen guard).
    vi.setSystemTime(new Date(spawnAt + 400));
    advanceAppearanceAnimationClock(spawnAt + 400);
    expect(agentLine(component, 'Explore Agent')).not.toContain('\u001B[0;1;2;38;2');
    vi.setSystemTime(new Date(spawnAt + 900));
    advanceAppearanceAnimationClock(spawnAt + 900);
    expect(agentLine(component, 'Explore Agent')).not.toContain('\u001B[0;1;2;38;2');
  });

  

  

  it('replayed subagent cards render without the spawn entrance (premium)', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new ToolCallComponent(
      {
        id: 'call_spawn_replay',
        name: 'SessionControl',
        args: { operation: 'spawn', description: 'replayed agent', prompt: 'replayed agent' },
        subagent: { id: 'sub_replay_1', name: 'explore', text: 'done work', toolCalls: [] },
      },
      { tool_call_id: 'call_spawn_replay', output: JSON.stringify({ agentId: 'sub_replay_1', taskId: 'task-replay', status: 'running' }), is_error: false },
    );

    // Past the transcript entrance wash so only a spawn entrance could add
    // the highlight SGR — replay never calls onSubagentSpawned, so none.
    vi.setSystemTime(new Date(start + 700));
    advanceAppearanceAnimationClock(start + 700);
    const out = component.render(100);
    expect(strip(out.join('\n'))).toContain('Explore Agent');
    expect(out.join('\n')).not.toContain('\u001B[0;1;2;38;2');
  });


  describe('transcript density (one-line compact/minimal mode)', () => {
    function bashComponent(result?: { output: string; is_error: boolean }): ToolCallComponent {
      return new ToolCallComponent(
        {
          id: 'call_density_bash',
          name: 'Bash',
          args: { command: 'echo density-fixture-token' },
        },
        result === undefined
          ? undefined
          : {
              tool_call_id: 'call_density_bash',
              output: result.output,
              is_error: result.is_error,
            },
      );
    }

    it('compact collapses the body to the header line', () => {
      const component = bashComponent({
        output: 'density-output-token\nsecond line',
        is_error: false,
      });
      const standard = strip(component.render(100).join('\n'));
      expect(standard).toContain('Used Bash');
      expect(standard).toContain('density-output-token');

      component.setDetail('compact');
      const compact = strip(component.render(100).join('\n'));
      expect(compact).toContain('Ran');
      expect(compact).not.toContain('Used Bash');
      expect(compact).not.toContain('density-output-token');
      expect(component.isOneLineCollapsed).toBe(true);
    });

    it('minimal collapses standalone cards the same way', () => {
      const component = bashComponent({ output: 'density-output-token', is_error: false });
      component.setDetail('minimal');
      const out = strip(component.render(100).join('\n'));
      // minimal hides successful standalone cards until the operator expands
      // one (failures punch through); the one-line collapse applies per row.
      expect(out).toBe('');
      expect(component.isOneLineCollapsed).toBe(true);
    });

    it('failed tools punch through the collapse with a one-line error', () => {
      const component = bashComponent({
        output: 'density-error-first\nnoise line two',
        is_error: true,
      });
      component.setDetail('compact');
      const out = strip(component.render(100).join('\n'));
      expect(out).toContain('density-error-first');
      expect(out).not.toContain('noise line two');
    });

    it('click toggle reopens a collapsed card and closes it again', () => {
      const component = bashComponent({ output: 'density-output-token', is_error: false });
      component.setDetail('compact');
      expect(component.isOneLineCollapsed).toBe(true);

      component.toggleDetailOverride();
      expect(component.isOneLineCollapsed).toBe(false);
      expect(strip(component.render(100).join('\n'))).toContain('density-output-token');

      component.toggleDetailOverride();
      expect(component.isOneLineCollapsed).toBe(true);
      expect(strip(component.render(100).join('\n'))).not.toContain('density-output-token');
    });

    it('global expand (Ctrl+O) wins over one-line density', () => {
      const component = bashComponent({ output: 'density-output-token', is_error: false });
      component.setDetail('compact');
      component.setExpanded(true);
      expect(component.isOneLineCollapsed).toBe(false);
      expect(strip(component.render(100).join('\n'))).toContain('density-output-token');
    });

    it('switching density clears the local click override', () => {
      const component = bashComponent({ output: 'density-output-token', is_error: false });
      component.setDetail('compact');
      component.toggleDetailOverride();
      expect(component.isOneLineCollapsed).toBe(false);
      component.setDetail('standard');
      component.setDetail('compact');
      expect(component.isOneLineCollapsed).toBe(true);
    });

    it('a result arriving while collapsed keeps the failure visible', () => {
      const component = bashComponent(undefined);
      component.setDetail('compact');
      component.setResult({
        tool_call_id: 'call_density_bash',
        output: 'late-error-line\ntrailing detail',
        is_error: true,
      });
      const out = strip(component.render(100).join('\n'));
      expect(out).toContain('late-error-line');
      expect(out).not.toContain('trailing detail');
    });

    it('full expands every card and leaving it restores collapse', () => {
      const component = bashComponent({ output: 'density-output-token', is_error: false });
      component.setDetail('full');
      expect(component.isOneLineCollapsed).toBe(false);
      expect(strip(component.render(100).join('\n'))).toContain('density-output-token');

      component.setDetail('compact');
      expect(component.isOneLineCollapsed).toBe(true);
      expect(strip(component.render(100).join('\n'))).not.toContain('density-output-token');
    });
  });

  describe('Used-unit trailing spacer (standard/full density)', () => {
    function finishedTool(id: string, name = 'Bash'): ToolCallComponent {
      return new ToolCallComponent(
        {
          id,
          name,
          args: { command: `echo ${id}` },
        },
        {
          tool_call_id: id,
          output: `${id}-body-line`,
          is_error: false,
        },
      );
    }

    function plainLines(component: ToolCallComponent): string[] {
      return component.render(100).map((line) => strip(line));
    }

    it('standard cards end with a blank tinted row so consecutive Used-units separate', () => {
      const previousLevel = chalk.level;
      chalk.level = 3;
      try {
        const first = finishedTool('unit_a');
        const second = finishedTool('unit_b');
        first.setDetail('standard');
        second.setDetail('standard');

        const firstLines = plainLines(first);
        expect(firstLines.some((line) => line.includes('Used'))).toBe(true);
        // Trailing blank is last row of the card (tinted by render, strip leaves '').
        expect(firstLines.at(-1)?.trim()).toBe('');

        // Sibling stream: blank between the end of unit A and the next Used header.
        const joined = [...first.render(100), ...second.render(100)].map((line) => strip(line));
        const firstUsed = joined.findIndex((line) => line.includes('Used') && line.includes('Bash'));
        const secondUsed = joined.findIndex(
          (line, i) => i > firstUsed && line.includes('Used') && line.includes('Bash'),
        );
        expect(firstUsed).toBeGreaterThanOrEqual(0);
        expect(secondUsed).toBeGreaterThan(firstUsed + 1);
        const between = joined.slice(firstUsed + 1, secondUsed);
        expect(between.some((line) => line.trim() === '')).toBe(true);

        // Blank row still carries work-block background (not an untinted sibling gap).
        // Entrance polish may fold bg into a compound SGR (`…;48;2;r;g;bm`), so
        // match the bg channel rather than a bare `\x1b[48;2` prefix.
        const tintedBlank = first.render(100).at(-1) ?? '';
        expect(tintedBlank).toMatch(/48;2/);
        expect(strip(tintedBlank).trim()).toBe('');
      } finally {
        chalk.level = previousLevel;
      }
    });

    it('full density also keeps one trailing blank per Used-unit', () => {
      const component = finishedTool('unit_full');
      component.setDetail('full');
      const lines = plainLines(component);
      expect(lines.at(-1)?.trim()).toBe('');
      expect(lines.some((line) => line.includes('Used'))).toBe(true);
    });

    it('compact one-line cards use a quiet title plus one breath line', () => {
      const component = finishedTool('unit_compact');
      component.setDetail('compact');
      const lines = plainLines(component);
      expect(component.isOneLineCollapsed).toBe(true);
      expect(lines[0]).toContain('Ran');
      expect(lines[0]).not.toContain('Used');
      expect(lines[0]?.trim()).not.toBe('');
      // One trailing breath line — not a tinted Used-unit spacer.
      expect(lines.at(-1)?.trim()).toBe('');
      expect(lines.length).toBe(2);
    });

    it('header remains localRow 0 (no leading blank) for density mouse', () => {
      const component = finishedTool('unit_header_row');
      component.setDetail('standard');
      const lines = plainLines(component);
      expect(lines[0]).toContain('Used');
      expect(lines[0]?.trim().length).toBeGreaterThan(0);
    });
  });
});
