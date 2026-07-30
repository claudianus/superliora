import { describe, expect, it, vi } from 'vitest';

import { dispatchHook, hookDedupeKey } from '../../src/session/hooks/dispatch';
import type { HookDef } from '../../src/session/hooks/types';

describe('dispatchHook', () => {
  it('runs command hooks via shell', async () => {
    const result = await dispatchHook(
      { event: 'PreToolUse', command: 'echo hi', type: 'command' },
      { tool_name: 'Bash' },
      { timeout: 5 },
    );
    expect(result.action).toBe('allow');
    expect(result.stdout?.trim()).toBe('hi');
  });

  it('POSTs JSON for http hooks and parses structured deny', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          hookSpecificOutput: {
            permissionDecision: 'deny',
            permissionDecisionReason: 'nope',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await dispatchHook(
      {
        event: 'PreToolUse',
        type: 'http',
        command: '',
        url: 'https://example.test/hook',
      },
      { tool_name: 'Bash' },
      { timeout: 5, fetch: fetchMock as unknown as typeof fetch },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.action).toBe('block');
    expect(result.reason).toBe('nope');
  });

  it('fail-opens on http non-OK unless body denies', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream down', { status: 503 }));
    const result = await dispatchHook(
      {
        event: 'PreToolUse',
        type: 'http',
        command: '',
        url: 'https://example.test/hook',
      },
      {},
      { timeout: 5, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result.action).toBe('allow');
    expect(result.stderr).toContain('503');
  });

  it('fail-opens mcp_tool/prompt/agent when host is missing', async () => {
    for (const hook of [
      {
        event: 'PreToolUse',
        type: 'mcp_tool' as const,
        command: '',
        server: 's',
        tool: 't',
      },
      { event: 'Stop', type: 'prompt' as const, command: '', prompt: 'check' },
      { event: 'Stop', type: 'agent' as const, command: '', prompt: 'check' },
    ] satisfies HookDef[]) {
      const result = await dispatchHook(hook, {}, { timeout: 1 });
      expect(result.action).toBe('allow');
      expect(result.stderr).toMatch(/no (MCP|LLM) host; skipped/);
    }
  });

  it('invokes mcp_tool via host', async () => {
    const callMcpTool = vi.fn(async () => ({ ok: true }));
    const result = await dispatchHook(
      {
        event: 'PreToolUse',
        type: 'mcp_tool',
        command: '',
        server: 'data',
        tool: 'ping',
      },
      { tool_name: 'Bash' },
      { timeout: 1, host: { callMcpTool } },
    );
    expect(callMcpTool).toHaveBeenCalledWith('data', 'ping', { tool_name: 'Bash' }, undefined);
    expect(result.action).toBe('allow');
    expect(result.stdout).toContain('"ok":true');
  });

  it('invokes prompt hooks via host', async () => {
    const runPrompt = vi.fn(async () => 'allow');
    const result = await dispatchHook(
      { event: 'Stop', type: 'prompt', command: '', prompt: 'check stop' },
      { reason: 'end' },
      { timeout: 1, host: { runPrompt } },
    );
    expect(runPrompt).toHaveBeenCalledWith('check stop', { reason: 'end' }, undefined);
    expect(result.action).toBe('allow');
    expect(result.stdout).toBe('allow');
  });
});

describe('hookDedupeKey', () => {
  it('distinguishes action kinds', () => {
    expect(
      hookDedupeKey({ event: 'PreToolUse', type: 'command', command: 'echo a' }),
    ).not.toBe(hookDedupeKey({ event: 'PreToolUse', type: 'http', command: '', url: 'echo a' }));
  });
});
