import { describe, expect, it } from 'vitest';
import type { ContentPart, ToolCall } from '@superliora/sdk';
import type { ContextMessage, PromptOrigin, SessionTrace } from '@superliora/sdk';

import {
  buildExportMarkdown,
  extractToolCallHint,
  formatContentPartMd,
  formatToolCallMd,
  groupIntoTurns,
  isInternalMessage,
} from '../../src/tui/utils/export-markdown';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userMsg(text: string, origin?: PromptOrigin): ContextMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin,
  };
}

function assistantMsg(
  text: string,
  toolCalls: ToolCall[] = [],
  thinkText?: string,
): ContextMessage {
  const content: ContentPart[] = [];
  if (thinkText !== undefined) {
    content.push({ type: 'think', think: thinkText });
  }
  content.push({ type: 'text', text });
  return {
    role: 'assistant',
    content,
    toolCalls,
  };
}

function toolMsg(callId: string, text: string): ContextMessage {
  return {
    role: 'tool',
    content: [{ type: 'text', text }],
    toolCalls: [],
    toolCallId: callId,
  };
}

function makeToolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return {
    type: 'function',
    id,
    name,
    arguments: JSON.stringify(args),
  };
}

// ---------------------------------------------------------------------------
// extractToolCallHint
// ---------------------------------------------------------------------------

describe('extractToolCallHint', () => {
  it('extracts path from arguments', () => {
    expect(extractToolCallHint(JSON.stringify({ path: '/foo/bar.ts' }))).toBe('/foo/bar.ts');
  });

  it('extracts command from arguments', () => {
    expect(extractToolCallHint(JSON.stringify({ command: 'ls -la' }))).toBe('ls -la');
  });

  it('prefers path over command', () => {
    expect(extractToolCallHint(JSON.stringify({ command: 'ls', path: '/a.ts' }))).toBe('/a.ts');
  });

  it('falls back to first short string value', () => {
    expect(extractToolCallHint(JSON.stringify({ foo: 'hello world' }))).toBe('hello world');
  });

  it('returns empty string for invalid JSON', () => {
    expect(extractToolCallHint('not json')).toBe('');
  });

  it('returns empty string for non-object JSON', () => {
    expect(extractToolCallHint('"just a string"')).toBe('');
  });

  it('truncates long values', () => {
    const long = 'a'.repeat(100);
    const hint = extractToolCallHint(JSON.stringify({ path: long }));
    expect(hint.length).toBeLessThanOrEqual(63); // 60 + "…"
  });
});

// ---------------------------------------------------------------------------
// formatContentPartMd
// ---------------------------------------------------------------------------

describe('formatContentPartMd', () => {
  it('renders text part', () => {
    expect(formatContentPartMd({ type: 'text', text: 'hello' })).toBe('hello');
  });

  it('renders think part as collapsible', () => {
    const result = formatContentPartMd({ type: 'think', think: 'reasoning here' });
    expect(result).toContain('<details>');
    expect(result).toContain('Thinking');
    expect(result).toContain('reasoning here');
  });

  it('returns empty for blank think', () => {
    expect(formatContentPartMd({ type: 'think', think: '   ' })).toBe('');
  });

  it('renders image placeholder', () => {
    expect(
      formatContentPartMd({ type: 'image_url', imageUrl: { url: 'http://x' } }),
    ).toBe('[image]');
  });

  it('renders audio placeholder', () => {
    expect(
      formatContentPartMd({ type: 'audio_url', audioUrl: { url: 'http://x' } }),
    ).toBe('[audio]');
  });

  it('renders video placeholder', () => {
    expect(
      formatContentPartMd({ type: 'video_url', videoUrl: { url: 'http://x' } }),
    ).toBe('[video]');
  });
});

// ---------------------------------------------------------------------------
// formatToolCallMd
// ---------------------------------------------------------------------------

describe('formatToolCallMd', () => {
  it('renders tool call with hint', () => {
    const tc = makeToolCall('c1', 'Bash', { command: 'ls' });
    const md = formatToolCallMd(tc);
    expect(md).toContain('#### Tool Call: Bash');
    expect(md).toContain('`ls`');
    expect(md).toContain('```json');
    expect(md).toContain('"command": "ls"');
  });

  it('renders tool call without hint', () => {
    const tc = makeToolCall('c1', 'CustomTool', {});
    const md = formatToolCallMd(tc);
    expect(md).toContain('#### Tool Call: CustomTool');
    expect(md).not.toContain('(`');
  });
});

// ---------------------------------------------------------------------------
// isInternalMessage
// ---------------------------------------------------------------------------

describe('isInternalMessage', () => {
  it('marks injection origin as internal', () => {
    expect(isInternalMessage(userMsg('x', { kind: 'injection', variant: 'test' }))).toBe(true);
  });

  it('marks system_trigger origin as internal', () => {
    expect(
      isInternalMessage(userMsg('x', { kind: 'system_trigger', name: 'test' })),
    ).toBe(true);
  });

  it('marks compaction_summary origin as internal', () => {
    expect(isInternalMessage(userMsg('x', { kind: 'compaction_summary' }))).toBe(true);
  });

  it('marks hook_result origin as internal', () => {
    expect(
      isInternalMessage(userMsg('x', { kind: 'hook_result', event: 'test' })),
    ).toBe(true);
  });

  it('marks cron_job origin as internal', () => {
    expect(
      isInternalMessage(
        userMsg('x', {
          kind: 'cron_job',
          jobId: 'a1b2c3d4',
          cron: '0 9 * * *',
          recurring: true,
          coalescedCount: 1,
          stale: false,
        }),
      ),
    ).toBe(true);
  });

  it('marks cron_missed origin as internal', () => {
    expect(
      isInternalMessage(userMsg('x', { kind: 'cron_missed', count: 2 })),
    ).toBe(true);
  });

  it('keeps real user messages', () => {
    expect(isInternalMessage(userMsg('hello', { kind: 'user' }))).toBe(false);
  });

  it('keeps assistant messages', () => {
    expect(isInternalMessage(assistantMsg('hi'))).toBe(false);
  });

  it('keeps tool messages', () => {
    expect(isInternalMessage(toolMsg('c1', 'output'))).toBe(false);
  });

  it('keeps user messages without origin', () => {
    expect(isInternalMessage(userMsg('hello'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// groupIntoTurns
// ---------------------------------------------------------------------------

describe('groupIntoTurns', () => {
  it('groups messages into turns starting at user messages', () => {
    const msgs: ContextMessage[] = [
      userMsg('q1', { kind: 'user' }),
      assistantMsg('a1'),
      userMsg('q2', { kind: 'user' }),
      assistantMsg('a2'),
    ];
    const turns = groupIntoTurns(msgs);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveLength(2);
    expect(turns[1]).toHaveLength(2);
  });

  it('skips internal messages', () => {
    const msgs: ContextMessage[] = [
      userMsg('q1', { kind: 'user' }),
      userMsg('injected', { kind: 'injection', variant: 'test' }),
      assistantMsg('a1'),
    ];
    const turns = groupIntoTurns(msgs);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toHaveLength(2);
  });

  it('returns empty for empty input', () => {
    expect(groupIntoTurns([])).toHaveLength(0);
  });

  it('handles tool messages within a turn', () => {
    const tc = makeToolCall('c1', 'Bash', { command: 'ls' });
    const msgs: ContextMessage[] = [
      userMsg('do it', { kind: 'user' }),
      assistantMsg('ok', [tc]),
      toolMsg('c1', 'file1.txt'),
      assistantMsg('done'),
    ];
    const turns = groupIntoTurns(msgs);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// buildExportMarkdown
// ---------------------------------------------------------------------------

describe('buildExportMarkdown', () => {
  const now = new Date('2026-05-27T10:00:00+08:00');

  it('builds complete markdown with frontmatter and overview', () => {
    const msgs: ContextMessage[] = [
      userMsg('Hello world', { kind: 'user' }),
      assistantMsg('Hi there'),
    ];
    const md = buildExportMarkdown({
      sessionId: 'ses_abc12345xyz',
      workDir: '/home/user/project',
      history: msgs,
      tokenCount: 1234,
      now,
    });

    expect(md).toContain('---');
    expect(md).toContain('session_id: ses_abc12345xyz');
    expect(md).toContain('work_dir: /home/user/project');
    expect(md).toContain('message_count: 2');
    expect(md).toContain('token_count: 1234');
    expect(md).toContain('# SuperLiora Session Export');
    expect(md).toContain('## Overview');
    expect(md).toContain('Hello world');
    expect(md).toContain('## Turn 1');
    expect(md).toContain('### User');
    expect(md).toContain('### Assistant');
    expect(md).toContain('Hi there');
  });

  it('includes thinking in collapsible details', () => {
    const msgs: ContextMessage[] = [
      userMsg('question', { kind: 'user' }),
      assistantMsg('answer', [], 'deep thought'),
    ];
    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 0,
      now,
    });
    expect(md).toContain('<details><summary>Thinking</summary>');
    expect(md).toContain('deep thought');
  });

  it('renders tool calls and results', () => {
    const tc = makeToolCall('c1', 'Read', { file_path: '/foo.ts' });
    const msgs: ContextMessage[] = [
      userMsg('read file', { kind: 'user' }),
      assistantMsg('let me read', [tc]),
      toolMsg('c1', 'file contents here'),
      assistantMsg('the file contains...'),
    ];
    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 0,
      now,
    });
    expect(md).toContain('#### Tool Call: Read');
    expect(md).toContain('`/foo.ts`');
    expect(md).toContain('Tool Result: Read');
    expect(md).toContain('file contents here');
  });

  it('filters out internal messages', () => {
    const msgs: ContextMessage[] = [
      userMsg('hello', { kind: 'user' }),
      userMsg('injected stuff', { kind: 'injection', variant: 'system-reminder' }),
      assistantMsg('response'),
    ];
    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 0,
      now,
    });
    expect(md).not.toContain('injected stuff');
    expect(md).toContain('hello');
    expect(md).toContain('response');
  });

  it('counts turns correctly in overview', () => {
    const msgs: ContextMessage[] = [
      userMsg('q1', { kind: 'user' }),
      assistantMsg('a1'),
      userMsg('q2', { kind: 'user' }),
      assistantMsg('a2'),
      userMsg('q3', { kind: 'user' }),
      assistantMsg('a3'),
    ];
    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 500,
      now,
    });
    expect(md).toContain('3 user turns');
    expect(md).toContain('## Turn 1');
    expect(md).toContain('## Turn 2');
    expect(md).toContain('## Turn 3');
  });

  it('counts tool calls in overview', () => {
    const tc1 = makeToolCall('c1', 'Bash', { command: 'ls' });
    const tc2 = makeToolCall('c2', 'Read', { file_path: '/a.ts' });
    const msgs: ContextMessage[] = [
      userMsg('do things', { kind: 'user' }),
      assistantMsg('ok', [tc1, tc2]),
      toolMsg('c1', 'out1'),
      toolMsg('c2', 'out2'),
    ];
    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 0,
      now,
    });
    expect(md).toContain('2 tool calls');
  });

  it('labels assistant-only continuations separately from user turns', () => {
    const msgs: ContextMessage[] = [assistantMsg('goal continuation result')];
    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 0,
      now,
    });
    expect(md).toContain('0 user turns | 1 assistant continuations');
    expect(md).toContain('## Assistant Continuation 1');
    expect(md).not.toContain('## Turn 1');
  });

  it('renders trace lifecycle, ultrawork events, artifacts, and redaction counts', () => {
    const msgs: ContextMessage[] = [
      userMsg('build a game', { kind: 'user' }),
      assistantMsg('working'),
    ];
    const trace: SessionTrace = {
      sessionId: 'ses_test',
      agentId: 'main',
      generatedAt: now.toISOString(),
      context: { history: msgs, tokenCount: 10 },
      completeness: {
        source: 'records',
        recordCount: 4,
        traceEventCount: 2,
        messageCount: 2,
        filteredInternalMessageCount: 1,
        toolCallCount: 1,
        toolResultCount: 1,
        subagentLifecycleCount: 1,
        ultraworkEventCount: 1,
        redactedCount: 1,
        warnings: [],
      },
      events: [
        {
          id: '1',
          index: 0,
          type: 'subagent.spawned',
          title: 'Subagent spawned',
          summary: 'visual reviewer',
          data: { subagentId: 'agent_1', coverageLane: 'visual_qa' },
        },
        {
          id: '2',
          index: 1,
          type: 'ultrawork.stage.changed',
          title: 'Ultrawork stage changed',
          summary: 'verify',
          data: { runId: 'uw_1', to: 'verify' },
        },
      ],
      verificationArtifacts: [
        {
          id: 'verify_1',
          kind: 'ultrawork.verification',
          title: 'Ultrawork verification',
          status: 'pass',
        },
      ],
    };

    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 10,
      now,
      trace,
    });

    expect(md).toContain('## Session Trace');
    expect(md).toContain('records | 2 events | 1 subagent lifecycle | 1 ultrawork');
    expect(md).toContain('subagent.spawned');
    expect(md).toContain('ultrawork.stage.changed');
    expect(md).toContain('verify_1: Ultrawork verification [pass]');
    expect(md).toContain('Redactions');
  });

  it('redacts secrets in exported text and tool arguments', () => {
    const tc = makeToolCall('c1', 'SecretTool', {
      command: 'use token',
      api_key: 'sk-12345678901234567890',
    });
    const msgs: ContextMessage[] = [
      userMsg('token is sk-abcdefghijklmnopqrstuvwxyz', { kind: 'user' }),
      assistantMsg('calling', [tc]),
    ];
    const md = buildExportMarkdown({
      sessionId: 'ses_test',
      workDir: '/tmp',
      history: msgs,
      tokenCount: 0,
      now,
    });
    expect(md).toContain('[redacted]');
    expect(md).not.toContain('sk-12345678901234567890');
    expect(md).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });
});
