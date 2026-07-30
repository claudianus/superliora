import { describe, expect, it } from 'vitest';

import { HOOK_EVENT_TYPES } from '../../src/session/hooks/types';
import { HookDefSchema } from '../../src/config/schema';

describe('Claude-canonical hook events', () => {
  it('includes Claude deny/setup/batch events alongside SuperLiora hosts', () => {
    expect(HOOK_EVENT_TYPES).toContain('PermissionDenied');
    expect(HOOK_EVENT_TYPES).toContain('Setup');
    expect(HOOK_EVENT_TYPES).toContain('PostToolBatch');
    expect(HOOK_EVENT_TYPES).toContain('PermissionResult');
    expect(HOOK_EVENT_TYPES).toContain('Interrupt');
  });

  it('accepts PermissionDenied in HookDefSchema for config/plugin ingest', () => {
    const parsed = HookDefSchema.safeParse({
      event: 'PermissionDenied',
      command: 'echo denied',
    });
    expect(parsed.success).toBe(true);
  });
});
