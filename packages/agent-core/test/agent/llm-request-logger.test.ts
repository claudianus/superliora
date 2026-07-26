import { describe, expect, it } from 'vitest';

import { splitGenerateOptions } from '#/agent/llm-request-logger';

describe('agent/llm-request-logger — splitGenerateOptions', () => {
  it('returns the all-undefined shape when input is undefined', () => {
    expect(splitGenerateOptions(undefined)).toEqual({
      requestLogFields: undefined,
      runtimeModelAlias: undefined,
      runtimeCredentialLabel: undefined,
      generateOptions: undefined,
    });
  });

  it('strips requestLogFields / runtimeModelAlias / runtimeCredentialLabel and keeps the rest', () => {
    const out = splitGenerateOptions({
      requestLogFields: { sessionId: 's1' },
      runtimeModelAlias: 'gpt-4o-mini',
      runtimeCredentialLabel: 'cred-1',
      maxSteps: 5,
    } as never);
    expect(out.requestLogFields).toEqual({ sessionId: 's1' });
    expect(out.runtimeModelAlias).toBe('gpt-4o-mini');
    expect(out.runtimeCredentialLabel).toBe('cred-1');
    expect(out.generateOptions).toMatchObject({ maxSteps: 5 });
    expect(out.generateOptions).not.toHaveProperty('requestLogFields');
    expect(out.generateOptions).not.toHaveProperty('runtimeModelAlias');
    expect(out.generateOptions).not.toHaveProperty('runtimeCredentialLabel');
  });

  it('returns undefined for the three log fields when they are not present', () => {
    const out = splitGenerateOptions({ maxSteps: 3 } as never);
    expect(out.requestLogFields).toBeUndefined();
    expect(out.runtimeModelAlias).toBeUndefined();
    expect(out.runtimeCredentialLabel).toBeUndefined();
    expect(out.generateOptions).toMatchObject({ maxSteps: 3 });
  });
});
