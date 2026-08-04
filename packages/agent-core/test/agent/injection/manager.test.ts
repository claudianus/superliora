import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import {
  INJECTION_BATCH_MAX_CHARS,
  INJECTION_PART_MAX_CHARS,
  InjectionManager,
  __testing__capBatchParts,
} from '#/agent/injection/manager';

describe('agent/injection/manager — InjectionManager construction', () => {
  it('can be constructed with a minimal agent (smoke)', () => {
    const agent = {
      type: 'main',
      tools: { loopTools: [] },
      context: { history: [], appendSystemReminder: () => undefined },
      planMode: { isActive: false, isUltraMode: false, phase: null, planFilePath: null },
      getResponseLanguagePreference: () => undefined,
      goal: undefined,
      memory: undefined,
      skills: undefined,
      contextOS: undefined,
    } as unknown as Agent;
    expect(() => new InjectionManager(agent)).not.toThrow();
  });

  it('can be constructed for a sub-agent type without a goal', () => {
    const agent = {
      type: 'sub',
      tools: { loopTools: [] },
      context: { history: [] },
    } as unknown as Agent;
    expect(() => new InjectionManager(agent)).not.toThrow();
  });
});

describe('agent/injection/manager — batch caps', () => {
  it('leaves normal-sized parts untouched', () => {
    const parts = ['alpha', 'beta'.repeat(100)];
    expect(__testing__capBatchParts(parts)).toEqual(parts);
  });

  it('trims a runaway part head-first with a marker', () => {
    const huge = 'x'.repeat(INJECTION_PART_MAX_CHARS + 5_000);
    const [trimmed] = __testing__capBatchParts([huge]);
    expect(trimmed!.length).toBeLessThanOrEqual(INJECTION_PART_MAX_CHARS);
    expect(trimmed).toContain('trimmed for injection budget');
    expect(trimmed!.startsWith('x')).toBe(true);
  });

  it('keeps the whole batch under the total budget without dropping small parts', () => {
    const big = 'a'.repeat(INJECTION_PART_MAX_CHARS);
    const small = 'keep-me';
    const capped = __testing__capBatchParts([big, big, big, small]);
    const total = capped.reduce((sum, part) => sum + part.length, 0);
    expect(total).toBeLessThanOrEqual(INJECTION_BATCH_MAX_CHARS);
    expect(capped).toContain(small);
  });
});
