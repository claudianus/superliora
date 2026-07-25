import { describe, expect, it } from 'vitest';

import {
  inferCheapModelAliasSync,
  resolveSubagentModelAlias,
} from '../../src/utils/cheap-model';

describe('resolveSubagentModelAlias', () => {
  const models = {
    'kimi-k2.5': { model: 'kimi-k2.5', provider: 'kimi' },
    'gemini-2.5-flash-lite': { model: 'gemini-2.5-flash-lite', provider: 'google' },
  };

  it('returns parent model for non-explore profiles', () => {
    expect(
      resolveSubagentModelAlias('coder', undefined, 'kimi-k2.5', models, 'gemini-2.5-flash-lite'),
    ).toBe('kimi-k2.5');
  });

  it('prefers explicit explorationModel for explore profiles', () => {
    expect(
      resolveSubagentModelAlias(
        'explore',
        undefined,
        'kimi-k2.5',
        models,
        'gemini-2.5-flash-lite',
      ),
    ).toBe('gemini-2.5-flash-lite');
  });

  it('falls back to inferred cheap model when explorationModel is unset', () => {
    expect(resolveSubagentModelAlias('explore', undefined, 'kimi-k2.5', models)).toBe(
      'gemini-2.5-flash-lite',
    );
  });

  it('falls back to parent model when no cheap model can be inferred', () => {
    expect(
      resolveSubagentModelAlias('explore', undefined, 'kimi-k2.5', {
        'kimi-k2.5': { model: 'kimi-k2.5' },
      }),
    ).toBe('kimi-k2.5');
  });

  it('treats profileBaseName explore as explore even when name differs', () => {
    expect(
      resolveSubagentModelAlias(
        'custom-scout',
        'explore',
        'kimi-k2.5',
        models,
        'gemini-2.5-flash-lite',
      ),
    ).toBe('gemini-2.5-flash-lite');
  });

  it('skips unhealthy explorationModel and cheap aliases', () => {
    const unhealthy = new Set(['gemini-2.5-flash-lite']);
    expect(
      resolveSubagentModelAlias(
        'explore',
        undefined,
        'kimi-k2.5',
        models,
        'gemini-2.5-flash-lite',
        {
          isAliasHealthy: (alias) => !unhealthy.has(alias),
        },
      ),
    ).toBe('kimi-k2.5');
  });

  it('inferCheapModelAliasSync skips unhealthy aliases', () => {
    expect(
      inferCheapModelAliasSync(models, (alias) => alias !== 'gemini-2.5-flash-lite'),
    ).toBeUndefined();
    expect(inferCheapModelAliasSync(models)).toBe('gemini-2.5-flash-lite');
  });
});
