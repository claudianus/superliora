import { describe, expect, it } from 'vitest';
import type { ModelAlias } from '@superliora/sdk';

import {
  decideModelRouteSurface,
  isSameEffectiveModel,
  normalizeModelToken,
  resolveModelRouteIdentity,
} from '../../../src/tui/utils/model-route-notice';

const models: Record<string, ModelAlias> = {
  'Grok 4.5': {
    provider: 'xai',
    model: 'grok-4.5',
    maxContextSize: 256_000,
    displayName: 'Grok 4.5',
  } as ModelAlias,
  'grok-4.5': {
    provider: 'xai',
    model: 'grok-4.5',
    maxContextSize: 256_000,
  } as ModelAlias,
  'kimi-k2': {
    provider: 'managed:kimi-api',
    model: 'kimi-k2',
    maxContextSize: 200_000,
    displayName: 'Kimi K2',
  } as ModelAlias,
  turbo: {
    provider: 'managed:kimi-api',
    model: 'kimi-turbo',
    maxContextSize: 200_000,
    displayName: 'Kimi Turbo',
  } as ModelAlias,
};

describe('normalizeModelToken', () => {
  it('collapses display-name punctuation to the same token', () => {
    expect(normalizeModelToken('Grok 4.5')).toBe('grok45');
    expect(normalizeModelToken('grok-4.5')).toBe('grok45');
    expect(normalizeModelToken('grok_4_5')).toBe('grok45');
  });
});

describe('isSameEffectiveModel', () => {
  it('treats display alias and id alias as the same Grok model', () => {
    const left = resolveModelRouteIdentity('Grok 4.5', models);
    const right = resolveModelRouteIdentity('grok-4.5', models, {
      providerModel: 'grok-4.5',
      providerName: 'xai',
    });
    expect(isSameEffectiveModel(left, right)).toBe(true);
  });

  it('rejects different underlying model ids', () => {
    const left = resolveModelRouteIdentity('kimi-k2', models);
    const right = resolveModelRouteIdentity('turbo', models);
    expect(isSameEffectiveModel(left, right)).toBe(false);
  });
});

describe('decideModelRouteSurface', () => {
  it('suppresses first-step alias rename of the same effective model', () => {
    const decision = decideModelRouteSurface({
      selection: {
        modelAlias: 'grok-4.5',
        providerName: 'xai',
        providerModel: 'grok-4.5',
      },
      previous: null,
      sessionModel: 'Grok 4.5',
      availableModels: models,
    });
    expect(decision.kind).toBe('none');
  });

  it('suppresses repeated same-route steps (main spam path)', () => {
    const selection = {
      modelAlias: 'grok-4.5',
      providerName: 'xai',
      credentialLabel: 'acct-a',
      providerModel: 'grok-4.5',
    };
    const first = decideModelRouteSurface({
      selection,
      previous: null,
      sessionModel: 'Grok 4.5',
      availableModels: models,
    });
    expect(first.kind).toBe('none');

    const second = decideModelRouteSurface({
      selection,
      previous: selection,
      sessionModel: 'Grok 4.5',
      availableModels: models,
    });
    expect(second.kind).toBe('none');
  });

  it('surfaces real failover when the previous step model changes', () => {
    const decision = decideModelRouteSurface({
      selection: {
        modelAlias: 'turbo',
        providerName: 'managed:kimi-api',
        credentialLabel: 'acct-b',
        providerModel: 'kimi-turbo',
      },
      previous: {
        modelAlias: 'kimi-k2',
        providerName: 'managed:kimi-api',
        credentialLabel: 'acct-a',
        providerModel: 'kimi-k2',
      },
      sessionModel: 'kimi-k2',
      availableModels: models,
    });
    expect(decision.kind).toBe('failover');
    expect(decision.fromAlias).toBe('kimi-k2');
    expect(decision.toAlias).toBe('turbo');
  });

  it('surfaces credential rotation without calling it failover', () => {
    const decision = decideModelRouteSurface({
      selection: {
        modelAlias: 'grok-4.5',
        providerName: 'xai',
        credentialLabel: 'acct-b',
        providerModel: 'grok-4.5',
      },
      previous: {
        modelAlias: 'grok-4.5',
        providerName: 'xai',
        credentialLabel: 'acct-a',
        providerModel: 'grok-4.5',
      },
      sessionModel: 'Grok 4.5',
      availableModels: models,
    });
    expect(decision.kind).toBe('selection');
    expect(decision.credentialChanged).toBe(true);
  });

  it('surfaces first step when session model is a different effective model', () => {
    const decision = decideModelRouteSurface({
      selection: {
        modelAlias: 'turbo',
        providerName: 'managed:kimi-api',
        providerModel: 'kimi-turbo',
      },
      previous: null,
      sessionModel: 'kimi-k2',
      availableModels: models,
    });
    expect(decision.kind).toBe('failover');
    expect(decision.fromAlias).toBe('kimi-k2');
    expect(decision.toAlias).toBe('turbo');
  });
});
