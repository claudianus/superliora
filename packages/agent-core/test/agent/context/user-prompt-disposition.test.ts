import { describe, expect, it } from 'vitest';

import {
  isRealUserPromptOrigin,
  userPromptDisposition,
  type PromptOrigin,
} from '#/agent/context/types';

const nonUserOrigins: readonly PromptOrigin[] = [
  { kind: 'shell_command', phase: 'input' },
  { kind: 'shell_command', phase: 'output', isError: true },
  { kind: 'compaction_summary' },
  { kind: 'system_trigger', name: 'operator-note' },
  {
    kind: 'background_task',
    taskId: 'bash-1',
    status: 'completed',
    notificationId: 'task:bash-1:completed',
  },
  { kind: 'retry', trigger: 'operator' },
];

describe('native user prompt disposition', () => {
  it.each([undefined, { kind: 'user' } satisfies PromptOrigin])(
    'retains real user intent for %j',
    (origin) => {
      expect(userPromptDisposition(origin)).toBe('keep');
      expect(isRealUserPromptOrigin(origin)).toBe(true);
    },
  );

  it.each(nonUserOrigins)('does not count %j as a user prompt', (origin) => {
    expect(userPromptDisposition(origin)).toBe('drop');
    expect(isRealUserPromptOrigin(origin)).toBe(false);
  });
});
