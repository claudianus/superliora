import { describe, expect, it } from 'vitest';

import { fileMetaSchema } from '../file';
import {
  backgroundTaskKindSchema,
  backgroundTaskSchema,
  backgroundTaskStatusSchema,
} from '../task';
import {
  mcpServerSchema,
  mcpServerStatusSchema,
  mcpServerTransportSchema,
  toolDescriptorSchema,
  toolSourceSchema,
} from '../tool';
import {
  fsChangeEventSchema,
  fsEntrySchema,
  fsGitStatusSchema,
  fsKindSchema,
  fsSearchHitSchema,
} from '../fs';
import {
  messageContentSchema,
  messageRoleSchema,
  messageSchema,
  textContentSchema,
  toolUseContentSchema,
} from '../message';
import {
  emptySessionUsage,
  sessionAgentConfigPartialSchema,
  sessionSchema,
  sessionStatusSchema,
  sessionUsageSchema,
} from '../session';

describe('protocol/file — file meta', () => {
  it('fileMetaSchema accepts a minimal file', () => {
    const f = fileMetaSchema.parse({
      id: 'f-1',
      name: 'a.txt',
      media_type: 'text/plain',
      size: 10,
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(f.size).toBe(10);
  });

  it('fileMetaSchema rejects a negative size', () => {
    expect(() =>
      fileMetaSchema.parse({
        id: 'f-1',
        name: 'a.txt',
        media_type: 'text/plain',
        size: -1,
        created_at: '2026-01-01T00:00:00Z',
      }),
    ).toThrow();
  });
});

describe('protocol/task — background task', () => {
  it('backgroundTaskKindSchema accepts the canonical set', () => {
    for (const v of ['subagent', 'bash', 'tool']) {
      expect(backgroundTaskKindSchema.parse(v)).toBe(v);
    }
    expect(() => backgroundTaskKindSchema.parse('x')).toThrow();
  });

  it('backgroundTaskStatusSchema accepts the lifecycle statuses', () => {
    for (const v of ['running', 'completed', 'failed', 'cancelled']) {
      expect(backgroundTaskStatusSchema.parse(v)).toBe(v);
    }
  });

  it('backgroundTaskSchema accepts a minimal task', () => {
    const t = backgroundTaskSchema.parse({
      id: 't-1',
      session_id: 's-1',
      kind: 'bash',
      description: 'run',
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(t.kind).toBe('bash');
  });
});

describe('protocol/tool — tool descriptor + mcp server', () => {
  it('toolSourceSchema accepts builtin/skill/mcp', () => {
    for (const v of ['builtin', 'skill', 'mcp']) {
      expect(toolSourceSchema.parse(v)).toBe(v);
    }
  });

  it('toolDescriptorSchema accepts a minimal descriptor', () => {
    const t = toolDescriptorSchema.parse({
      name: 'Bash',
      description: 'run',
      input_schema: { type: 'object' },
      source: 'builtin',
    });
    expect(t.name).toBe('Bash');
  });

  it('mcpServerStatusSchema accepts the connection states', () => {
    for (const v of ['connected', 'connecting', 'disconnected', 'error']) {
      expect(mcpServerStatusSchema.parse(v)).toBe(v);
    }
  });

  it('mcpServerTransportSchema accepts stdio/http/sse', () => {
    for (const v of ['stdio', 'http', 'sse']) {
      expect(mcpServerTransportSchema.parse(v)).toBe(v);
    }
  });

  it('mcpServerSchema accepts a minimal server', () => {
    const s = mcpServerSchema.parse({
      id: 'm-1',
      name: 'srv',
      transport: 'http',
      status: 'connected',
      tool_count: 3,
    });
    expect(s.tool_count).toBe(3);
  });
});

describe('protocol/fs — fs entries and search', () => {
  it('fsKindSchema accepts file/directory/symlink', () => {
    for (const v of ['file', 'directory', 'symlink']) {
      expect(fsKindSchema.parse(v)).toBe(v);
    }
  });

  it('fsGitStatusSchema accepts the canonical set', () => {
    for (const v of [
      'clean',
      'modified',
      'added',
      'deleted',
      'renamed',
      'untracked',
      'ignored',
      'conflicted',
    ]) {
      expect(fsGitStatusSchema.parse(v)).toBe(v);
    }
  });

  it('fsEntrySchema accepts a minimal entry', () => {
    const e = fsEntrySchema.parse({
      path: '/x',
      name: 'x',
      kind: 'file',
      modified_at: '2026-01-01T00:00:00Z',
    });
    expect(e.kind).toBe('file');
  });

  it('fsSearchHitSchema enforces score in [0,1]', () => {
    const base = {
      path: '/x',
      name: 'x',
      kind: 'file' as const,
      match_positions: [0],
    };
    expect(fsSearchHitSchema.parse({ ...base, score: 0.5 }).score).toBe(0.5);
    expect(() => fsSearchHitSchema.parse({ ...base, score: 1.5 })).toThrow();
  });

  it('fsChangeEventSchema wraps changes with positive coalesced window', () => {
    const e = fsChangeEventSchema.parse({
      changes: [],
      coalesced_window_ms: 250,
    });
    expect(e.coalesced_window_ms).toBe(250);
    expect(() =>
      fsChangeEventSchema.parse({ changes: [], coalesced_window_ms: 0 }),
    ).toThrow();
  });
});

describe('protocol/message — message content + envelope', () => {
  it('messageRoleSchema accepts user/assistant/tool/system', () => {
    for (const v of ['user', 'assistant', 'tool', 'system']) {
      expect(messageRoleSchema.parse(v)).toBe(v);
    }
  });

  it('textContentSchema accepts a text node', () => {
    const c = textContentSchema.parse({ type: 'text', text: 'hi' });
    expect(c.text).toBe('hi');
  });

  it('toolUseContentSchema requires a tool_call_id', () => {
    expect(() =>
      toolUseContentSchema.parse({
        type: 'tool_use',
        tool_name: 'Bash',
        input: {},
      }),
    ).toThrow();
  });

  it('messageContentSchema accepts a single content of each type', () => {
    expect(messageContentSchema.parse({ type: 'text', text: 'hi' }).type).toBe('text');
    expect(
      messageContentSchema.parse({
        type: 'tool_use',
        tool_call_id: 't-1',
        tool_name: 'Bash',
        input: {},
      }).type,
    ).toBe('tool_use');
    expect(
      messageContentSchema.parse({
        type: 'tool_result',
        tool_call_id: 't-1',
        output: 'ok',
      }).type,
    ).toBe('tool_result');
    expect(
      messageContentSchema.parse({
        type: 'image',
        source: { kind: 'url', url: 'https://example.test/a.png' },
      }).type,
    ).toBe('image');
  });

  it('messageSchema accepts a minimal message', () => {
    const m = messageSchema.parse({
      id: 'm-1',
      session_id: 's-1',
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(m.role).toBe('user');
  });
});

describe('protocol/session — session lifecycle', () => {
  it('sessionStatusSchema accepts the lifecycle states', () => {
    for (const v of [
      'idle',
      'running',
      'awaiting_approval',
      'awaiting_question',
      'aborted',
    ]) {
      expect(sessionStatusSchema.parse(v)).toBe(v);
    }
  });

  it('emptySessionUsage returns zeros', () => {
    const u = emptySessionUsage();
    expect(u.turn_count).toBe(0);
    expect(sessionUsageSchema.parse(u).turn_count).toBe(0);
  });

  it('sessionAgentConfigPartialSchema accepts an empty partial', () => {
    const p = sessionAgentConfigPartialSchema.parse({});
    expect(p).toEqual({});
  });

  it('sessionSchema accepts a minimal session', () => {
    const s = sessionSchema.parse({
      id: 's-1',
      workspace_id: 'wd_root_a1b2c3d4e5f6',
      title: 't',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      status: 'idle',
      metadata: { cwd: '/w' },
      agent_config: { model: 'm' },
      usage: emptySessionUsage(),
      permission_rules: [],
      message_count: 0,
      last_seq: 0,
    });
    expect(s.status).toBe('idle');
  });
});
