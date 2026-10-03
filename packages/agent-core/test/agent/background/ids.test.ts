import { describe, expect, it } from 'vitest';

import { BackgroundTaskPersistence } from '../../../src/agent/background';

describe('background persistence task id validation', () => {

  it('rejects malformed ids at the persistence path boundary', () => {
    const persistence = new BackgroundTaskPersistence('/tmp/kimi-bg-id-test');
    const rejected = [
      '',
      'x',
      '-bash',
      'BASH-12345678',
      'bash_12345678',
      '../escape',
      'bash-1234567',
      'bash-123456789',
      'agent-ABCDEFGH',
      'bg_12345678',
      'a'.repeat(26),
    ];

    for (const bad of rejected) {
      expect(() => persistence.taskOutputFile(bad)).toThrow(/Invalid task id/);
    }
  });
});
