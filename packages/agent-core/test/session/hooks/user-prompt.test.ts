import { describe, expect, it } from 'vitest';

import {
  renderHookResult,
  renderUserPromptHookBlockResult,
  renderUserPromptHookResult,
} from '../../../src/session/hooks/user-prompt';
import type { HookResult } from '../../../src/session/hooks/types';

describe('hooks/user-prompt.ts — renderHookResult', () => {
  it('wraps the message in a <hook_result> block tagged with the event', () => {
    expect(renderHookResult('UserPromptSubmit', 'hi')).toBe(
      '<hook_result hook_event="UserPromptSubmit">\nhi\n</hook_result>',
    );
  });
});

describe('hooks/user-prompt.ts — renderUserPromptHookResult', () => {
  it('returns undefined when results are missing', () => {
    expect(renderUserPromptHookResult(undefined)).toBeUndefined();
  });

  it('returns undefined when every result is filtered out (block, timeout, error exit)', () => {
    const results: HookResult[] = [
      { action: 'block', message: 'nope' },
      { action: 'passthrough', timedOut: true, message: 'late' },
      { action: 'passthrough', exitCode: 1, message: 'fail' },
    ];
    expect(renderUserPromptHookResult(results)).toBeUndefined();
  });

  it('renders surviving messages joined with blank lines and one <hook_result> per message', () => {
    const results: HookResult[] = [
      { action: 'passthrough', message: 'm1' },
      { action: 'passthrough', stdout: 's2' },
      { action: 'passthrough', message: '   ' }, // empty after trim → dropped
    ];
    const out = renderUserPromptHookResult(results);
    expect(out?.event).toBe('UserPromptSubmit');
    expect(out?.message).toBe('m1\n\ns2');
    expect(out?.text).toBe(
      '<hook_result hook_event="UserPromptSubmit">\nm1\n</hook_result>\n<hook_result hook_event="UserPromptSubmit">\ns2\n</hook_result>',
    );
  });
});

describe('hooks/user-prompt.ts — renderUserPromptHookBlockResult', () => {
  it('returns undefined when no block action is present', () => {
    expect(
      renderUserPromptHookBlockResult([{ action: 'passthrough', message: 'm' }]),
    ).toBeUndefined();
    expect(renderUserPromptHookBlockResult(undefined)).toBeUndefined();
  });

  it('uses the trimmed message when present', () => {
    const out = renderUserPromptHookBlockResult([
      { action: 'passthrough', message: 'm' },
      { action: 'block', message: '  no-go  ' },
    ]);
    expect(out?.message).toBe('no-go');
    expect(out?.text).toBe('<hook_result hook_event="UserPromptSubmit">\nno-go\n</hook_result>');
  });

  it('falls back to reason, then to the documented default when both are empty', () => {
    const reasonOut = renderUserPromptHookBlockResult([
      { action: 'block', message: '   ', reason: '  banned pattern  ' },
    ]);
    expect(reasonOut?.message).toBe('banned pattern');

    const defaultOut = renderUserPromptHookBlockResult([
      { action: 'block', message: '   ' },
    ]);
    expect(defaultOut?.message).toBe('Blocked by UserPromptSubmit hook');
  });
});
