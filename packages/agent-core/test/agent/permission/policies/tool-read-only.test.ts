import { describe, expect, it } from 'vitest';

import { isReadOnlyTool, READ_ONLY_TOOL_NAMES } from '#/agent/permission/policies/tool-read-only';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const makeContext = (over: Partial<PermissionPolicyContext> = {}): PermissionPolicyContext => ({
  toolCall: { id: 't1', name: 'Read', arguments: {} },
  execution: { toolName: 'Read' } as PermissionPolicyContext['execution'],
  ...over,
});

const setReadOnlyFlag = (ctx: PermissionPolicyContext, flag: boolean): PermissionPolicyContext => ({
  ...ctx,
  execution: { ...ctx.execution, readOnly: flag } as PermissionPolicyContext['execution'],
});

const setAccesses = (
  ctx: PermissionPolicyContext,
  accesses: PermissionPolicyContext['execution']['accesses'],
): PermissionPolicyContext => ({
  ...ctx,
  execution: { ...ctx.execution, accesses } as PermissionPolicyContext['execution'],
});

describe('agent/permission/policies/tool-read-only — isReadOnlyTool', () => {
  it('honors an explicit readOnly=true flag', () => {
    const ctx = setReadOnlyFlag(
      setAccesses(makeContext({ toolCall: { id: 't1', name: 'Bash', arguments: {} } }), undefined),
      true,
    );
    expect(isReadOnlyTool(ctx)).toBe(true);
  });

  it('honors an explicit readOnly=false flag', () => {
    const ctx = setReadOnlyFlag(
      setAccesses(makeContext({ toolCall: { id: 't1', name: 'Read', arguments: {} } }), undefined),
      false,
    );
    expect(isReadOnlyTool(ctx)).toBe(false);
  });

  it('rejects a tool with mutating accesses (write / readwrite / all) even when its name is in the read-only set', () => {
    const mutating = [
      { kind: 'file', operation: 'write' as const, path: '/tmp/x' },
    ] as PermissionPolicyContext['execution']['accesses'];
    const ctx = setAccesses(
      setReadOnlyFlag(
        makeContext({ toolCall: { id: 't1', name: 'Read', arguments: {} } }),
        undefined as never,
      ),
      mutating,
    );
    expect(isReadOnlyTool(ctx)).toBe(false);
  });

  it('returns true for a name in the static READ_ONLY_TOOL_NAMES set when accesses are empty', () => {
    const ctx = setAccesses(
      setReadOnlyFlag(
        makeContext({ toolCall: { id: 't1', name: 'Grep', arguments: {} } }),
        undefined as never,
      ),
      [],
    );
    expect(isReadOnlyTool(ctx)).toBe(true);
  });

  it('returns true for an MCP tool whose server segment matches a read-only keyword token', () => {
    const ctx = setAccesses(
      setReadOnlyFlag(
        makeContext({ toolCall: { id: 't1', name: 'mcp__context7__get', arguments: {} } }),
        undefined as never,
      ),
      [],
    );
    expect(isReadOnlyTool(ctx)).toBe(true);
  });

  it('rejects a name that is NOT in the read-only set, NOT an MCP tool, and has no flag', () => {
    const ctx = setAccesses(
      setReadOnlyFlag(
        makeContext({ toolCall: { id: 't1', name: 'Bash', arguments: {} } }),
        undefined as never,
      ),
      [],
    );
    expect(isReadOnlyTool(ctx)).toBe(false);
  });

  it('does NOT classify a tool as read-only from accesses: [] alone (no flag, unknown name)', () => {
    // Agent / BrowserObserve declare accesses: [] because they have no file
    // conflicts but still have side effects.
    const ctx = setAccesses(
      setReadOnlyFlag(
        makeContext({ toolCall: { id: 't1', name: 'Agent', arguments: {} } }),
        undefined as never,
      ),
      [],
    );
    expect(isReadOnlyTool(ctx)).toBe(false);
  });

  it('only matches MCP keyword tokens exactly (no substring matches)', () => {
    // "docker" must NOT match the "doc" keyword.
    const ctx = setAccesses(
      setReadOnlyFlag(
        makeContext({ toolCall: { id: 't1', name: 'mcp__docker-run__exec', arguments: {} } }),
        undefined as never,
      ),
      [],
    );
    expect(isReadOnlyTool(ctx)).toBe(false);
  });

  it('requires the mcp__<server>__<tool> shape (rejects mcp__ without a server separator)', () => {
    const ctx = setAccesses(
      setReadOnlyFlag(
        makeContext({ toolCall: { id: 't1', name: 'mcp__noSeparator', arguments: {} } }),
        undefined as never,
      ),
      [],
    );
    expect(isReadOnlyTool(ctx)).toBe(false);
  });
});

describe('agent/permission/policies/tool-read-only — READ_ONLY_TOOL_NAMES', () => {
  it('contains the core read-only builtins', () => {
    expect(READ_ONLY_TOOL_NAMES.has('Read')).toBe(true);
    expect(READ_ONLY_TOOL_NAMES.has('LioraRead')).toBe(true);
    expect(READ_ONLY_TOOL_NAMES.has('WebSearch')).toBe(true);
    expect(READ_ONLY_TOOL_NAMES.has('TodoList')).toBe(true);
  });

  it('does not contain clearly mutating tools', () => {
    expect(READ_ONLY_TOOL_NAMES.has('Bash')).toBe(false);
    expect(READ_ONLY_TOOL_NAMES.has('Write')).toBe(false);
    expect(READ_ONLY_TOOL_NAMES.has('Edit')).toBe(false);
  });
});
