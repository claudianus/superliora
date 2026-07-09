import type { ToolCall } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import type { PermissionPolicyContext } from '../../../src/agent/permission/types';
import type { ToolExecutionHookContext } from '../../../src/loop';
import { isReadOnlyTool } from '../../../src/agent/permission/policies/tool-read-only';

const signal = new AbortController().signal;

function ctx(
  toolName: string,
  options: {
    readOnly?: boolean;
    accesses?: PermissionPolicyContext['execution']['accesses'];
  } = {},
): PermissionPolicyContext {
  const hook: ToolExecutionHookContext = {
    turnId: '0',
    stepNumber: 1,
    signal,
    llm: {} as ToolExecutionHookContext['llm'],
    args: {},
    toolCall: {
      type: 'function',
      id: `call_${toolName}`,
      name: toolName,
      arguments: '{}',
    } satisfies ToolCall,
    toolCalls: [],
  };
  return {
    ...hook,
    execution: {
      accesses: options.accesses,
      readOnly: options.readOnly,
      approvalRule: toolName,
      execute: async () => ({ output: '' }),
    },
  };
}

describe('isReadOnlyTool', () => {
  it('returns true when readOnly flag is explicitly set', () => {
    expect(isReadOnlyTool(ctx('CustomTool', { readOnly: true }))).toBe(true);
  });

  it('returns false when readOnly is false', () => {
    expect(isReadOnlyTool(ctx('CustomTool', { readOnly: false }))).toBe(false);
  });

  it('returns false when accesses has a write operation', () => {
    expect(
      isReadOnlyTool(
        ctx('SomeTool', {
          accesses: [{ kind: 'file', operation: 'write', path: '/x.ts' }],
        }),
      ),
    ).toBe(false);
  });

  it('returns false when accesses has kind all', () => {
    expect(
      isReadOnlyTool(ctx('SomeTool', { accesses: [{ kind: 'all' }] })),
    ).toBe(false);
  });

  it('does NOT treat none() alone as read-only (side effects possible)', () => {
    // Agent tool declares accesses: none() but has side effects.
    expect(isReadOnlyTool(ctx('Agent', { accesses: [] }))).toBe(false);
  });

  it('treats none() + static set membership as read-only', () => {
    // WebSearch declares none() but is in the static read-only set.
    expect(isReadOnlyTool(ctx('WebSearch', { accesses: [] }))).toBe(true);
  });

  it('treats read operation + static set membership as read-only', () => {
    expect(
      isReadOnlyTool(
        ctx('Read', {
          accesses: [{ kind: 'file', operation: 'read', path: '/x.ts' }],
        }),
      ),
    ).toBe(true);
  });

  it('treats read operation WITHOUT static set membership as NOT read-only', () => {
    expect(
      isReadOnlyTool(
        ctx('UnknownReadTool', {
          accesses: [{ kind: 'file', operation: 'read', path: '/x.ts' }],
        }),
      ),
    ).toBe(false);
  });

  it('returns true for known read-only MCP pattern (context7)', () => {
    expect(isReadOnlyTool(ctx('mcp__plugin_context7_context7__query-docs'))).toBe(true);
  });

  it('returns false for unknown MCP tool (potential write)', () => {
    expect(isReadOnlyTool(ctx('mcp__github__create_issue'))).toBe(false);
  });

  it('returns false for accesses undefined + not in static set', () => {
    expect(isReadOnlyTool(ctx('SomeUnknownTool', { accesses: undefined }))).toBe(false);
  });
});

describe('isReadOnlyTool — MCP keyword token matching', () => {
  it.each([
    'mcp__plugin_context7_context7__query-docs',
    'mcp__docs_server__get_docs',
    'mcp__search_mcp__search',
    'mcp__fetch_tool__fetch',
    'mcp__context7__resolve',
    'mcp__docs-server__get',
    'mcp__my-search__query',
  ])('classifies known read-only MCP tool as read-only: %s', (toolName) => {
    expect(isReadOnlyTool(ctx(toolName))).toBe(true);
  });

  it.each([
    'mcp__github__create_issue',
    'mcp__slack__post_message',
    'mcp__database__execute',
    // Substring false positives that must NOT match (security):
    'mcp__docker__run',          // 'docker' ≠ 'doc'/'docs'
    'mcp__docker__exec',
    'mcp__research__write_note', // 'research' ≠ 'search'
    'mcp__fetcher__post_webhook',// 'fetcher' ≠ 'fetch'
    'mcp__docstore__delete_doc', // 'docstore' ≠ 'doc'/'docs'
    'mcp__doctool__overwrite',   // 'doctool' ≠ 'doc'/'docs'
    // Keyword in tool name, not server name — must not match:
    'mcp__notion__search_pages',
    'mcp__confluence__get_docs',
  ])('does NOT classify write/unknown MCP tool as read-only: %s', (toolName) => {
    expect(isReadOnlyTool(ctx(toolName))).toBe(false);
  });
});
