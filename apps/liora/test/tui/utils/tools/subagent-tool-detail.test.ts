import { describe, expect, it } from 'vitest';
import { lastNonEmptyLine, resolveSubagentToolTarget } from '#/tui/utils/tools/subagent-tool-detail';
describe('observed worker runtime targets', () => {
  it('prefers the emitted Bash command over the argument preview', () => {
    expect(resolveSubagentToolTarget({ kind: 'bash', command: 'pnpm test' }, '{"command":"other"}')).toBe('pnpm test');
  });
  it('projects SessionControl description or operation without tool-specific fiction', () => {
    expect(resolveSubagentToolTarget(undefined, '{"operation":"spawn","description":"Fix login"}')).toBe('Fix login');
    expect(resolveSubagentToolTarget({ kind: 'session', operation: 'spawn', description: 'Child task' }, undefined)).toBe('Child task');
    expect(resolveSubagentToolTarget({ kind: 'session', operation: 'wait' }, undefined)).toBe('wait');
    expect(resolveSubagentToolTarget(undefined, '{"operation":"wait","id":"child"}')).toBe('wait');
    expect(resolveSubagentToolTarget(undefined, '{"command":"printf hi"}')).toBe('printf hi');
    expect(resolveSubagentToolTarget(undefined, undefined)).toBeUndefined();
    expect(resolveSubagentToolTarget(undefined, '{"command":')).toBeUndefined();
  });
  it('preserves the most recent non-empty stream line for dock paint', () => {
    expect(lastNonEmptyLine('first\r\nsecond\r\n\n')).toBe('second');
    expect(lastNonEmptyLine('')).toBe('');
  });
});
