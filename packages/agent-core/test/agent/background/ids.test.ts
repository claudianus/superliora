import { join } from 'pathe';

import { describe, expect, it } from 'vitest';

import { BackgroundTaskPersistence } from '../../../src/agent/background';
import { generateTaskId } from '../../../src/agent/background/managed-types';

describe('background persistence task id validation', () => {
  it('generates prefixed base36 ids accepted by the persistence boundary', () => {
    const sessionDir = '/tmp/kimi-bg-id-test';
    const persistence = new BackgroundTaskPersistence(sessionDir);
    for (const prefix of ['bash', 'native-process']) {
      for (let i = 0; i < 32; i++) {
        const id = generateTaskId(prefix);
        expect(id.startsWith(`${prefix}-`)).toBe(true);
        expect(id.slice(prefix.length + 1)).toMatch(/^[0-9a-z]{8}$/);
        expect(persistence.taskOutputFile(id)).toBe(join(sessionDir, 'tasks', id, 'output.log'));
      }
    }
  });

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
