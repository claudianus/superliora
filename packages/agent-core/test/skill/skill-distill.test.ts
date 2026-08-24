import { describe, expect, it } from 'vitest';

import {
  parseDistilledSkill,
  parseLessonGate,
  SkillDistillError,
  hasDistillSignal,
} from '../../src/skill/skill-distill';

describe('parseLessonGate', () => {
  it('accepts a yes with kind', () => {
    const gate = parseLessonGate(
      JSON.stringify({
        hasLesson: true,
        lessonKind: 'recovery_playbook',
        rationale: 'Windows spawn EPERM then test-local succeeded',
        focus: 'distill the test-local runner path',
      }),
    );
    expect(gate.hasLesson).toBe(true);
    expect(gate.lessonKind).toBe('recovery_playbook');
  });

  it('accepts a no without kind', () => {
    const gate = parseLessonGate(
      JSON.stringify({ hasLesson: false, rationale: 'same command retried after timeout' }),
    );
    expect(gate.hasLesson).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseLessonGate('not json')).toThrow(SkillDistillError);
  });

  it('drops an unknown lessonKind instead of failing the gate', () => {
    const gate = parseLessonGate(
      JSON.stringify({
        hasLesson: true,
        lessonKind: 'nonobvious_fact|inferred_constraint|recovery_playbook|user_correction',
        rationale: 'Windows pnpm ENOENT then node.exe succeeded',
        focus: 'runtime PATH',
      }),
    );
    expect(gate.hasLesson).toBe(true);
    expect(gate.lessonKind).toBeUndefined();
  });
});

describe('parseDistilledSkill', () => {
  it('parses a searchable playbook', () => {
    const skill = parseDistilledSkill(
      JSON.stringify({
        name: 'windows-pnpm-e2e-spawn',
        description:
          'Windows pnpm e2e hits spawn EPERM; run via node scripts/test-local.mjs. Use for Windows e2e, pnpm test, spawn EPERM.',
        whenToUse: 'When Windows e2e or vitest spawn EPERM or pnpm test fails only locally',
        triggers: ['windows e2e', 'spawn EPERM', 'test-local'],
        body: [
          '1. Run `node scripts/test-local.mjs` instead of raw pnpm test.',
          '2. Keep TZ=UTC from the runner.',
          '',
          'Done when the focused test file exits 0 under test-local.',
        ].join('\n'),
        evidence: 'Bash failed with spawn EPERM; test-local exited 0',
      }),
    );
    expect(skill.name).toBe('windows-pnpm-e2e-spawn');
    expect(skill.triggers).toContain('test-local');
  });

  it('rejects a retry-slug name', () => {
    expect(() =>
      parseDistilledSkill(
        JSON.stringify({
          name: 'Retry Bash',
          description: 'retry',
          whenToUse: 'when',
          triggers: ['x'],
          body: 'body',
          evidence: 'e',
        }),
      ),
    ).toThrow(SkillDistillError);
  });
});

describe('hasDistillSignal', () => {
  it('is true only for a successful retry', () => {
    expect(hasDistillSignal([{ toolName: 'Bash', success: true, retryCount: 0 }])).toBe(false);
    expect(hasDistillSignal([{ toolName: 'Bash', success: true, retryCount: 2 }])).toBe(true);
  });
});
