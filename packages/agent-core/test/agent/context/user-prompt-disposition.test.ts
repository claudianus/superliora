import { describe, expect, it } from 'vitest';

import {
  isRealUserPromptOrigin,
  userPromptDisposition,
} from '#/agent/context/types';
import type { PromptOrigin } from '#/agent/context/types';

describe('context/types — userPromptDisposition', () => {
  it('returns "keep" for undefined origin', () => {
    expect(userPromptDisposition(undefined)).toBe('keep');
  });

  it('keeps the user kind origin', () => {
    expect(userPromptDisposition({ kind: 'user' } as PromptOrigin)).toBe('keep');
  });

  it('keeps skill_activation with user-slash trigger and drops other triggers', () => {
    expect(
      userPromptDisposition({ kind: 'skill_activation', trigger: 'user-slash' } as PromptOrigin),
    ).toBe('keep');
    expect(userPromptDisposition({ kind: 'skill_activation', trigger: 'auto' } as PromptOrigin)).toBe(
      'drop',
    );
  });

  it('keeps plugin_command with user-slash trigger and drops other triggers', () => {
    expect(
      userPromptDisposition({ kind: 'plugin_command', trigger: 'user-slash' } as PromptOrigin),
    ).toBe('keep');
    expect(userPromptDisposition({ kind: 'plugin_command', trigger: 'auto' } as PromptOrigin)).toBe(
      'drop',
    );
  });

  it('drops all non-user, non-skill, non-plugin origins', () => {
    const kinds: PromptOrigin['kind'][] = [
      'injection',
      'shell_command',
      'compaction_summary',
      'system_trigger',
      'background_task',
      'cron_job',
      'cron_missed',
      'hook_result',
      'retry',
    ];
    for (const kind of kinds) {
      expect(userPromptDisposition({ kind } as PromptOrigin)).toBe('drop');
    }
  });
});

describe('context/types — isRealUserPromptOrigin', () => {
  it('returns true for undefined origin (treated as a real user prompt)', () => {
    expect(isRealUserPromptOrigin(undefined)).toBe(true);
  });

  it('returns true for "user" origin', () => {
    expect(isRealUserPromptOrigin({ kind: 'user' } as PromptOrigin)).toBe(true);
  });

  it('returns true for user-slash skill/plugin origins', () => {
    expect(
      isRealUserPromptOrigin({ kind: 'skill_activation', trigger: 'user-slash' } as PromptOrigin),
    ).toBe(true);
    expect(
      isRealUserPromptOrigin({ kind: 'plugin_command', trigger: 'user-slash' } as PromptOrigin),
    ).toBe(true);
  });

  it('returns false for dropped kinds', () => {
    expect(isRealUserPromptOrigin({ kind: 'injection' } as PromptOrigin)).toBe(false);
    expect(isRealUserPromptOrigin({ kind: 'retry' } as PromptOrigin)).toBe(false);
  });
});
