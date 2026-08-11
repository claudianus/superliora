import { describe, expect, it } from 'vitest';

import {
  applyCursorOAuthModelAliases,
  CURSOR_FALLBACK_MODELS,
  cursorModelsToPresets,
  cursorUsableModelToDiscoveredModel,
  decodeUsableModelIds,
  normalizeAvailableModels,
  toCursorCatalogModelId,
} from '../src/profiles/cursor-available-models';

describe('normalizeAvailableModels', () => {
  it('expands variants into picker ids using legacySlug', () => {
    const models = normalizeAvailableModels([
      {
        name: 'composer-2.5',
        clientDisplayName: 'Composer 2.5',
        supportsThinking: true,
        supportsImages: false,
        serverModelName: 'composer-2.5',
        variants: [
          {
            legacySlug: 'composer-2.5',
            displayName: 'Composer 2.5',
            isDefaultNonMaxConfig: true,
            parameterValues: [{ id: 'context', value: '200k' }],
          },
          {
            legacySlug: 'composer-2.5-fast',
            displayName: 'Composer 2.5',
            isDefaultNonMaxConfig: true,
            parameterValues: [
              { id: 'context', value: '200k' },
              { id: 'fast', value: 'true' },
            ],
          },
        ],
      },
    ]);

    expect(models.map((m) => m.id)).toEqual(['composer-2.5', 'composer-2.5-fast']);
    expect(models.find((m) => m.id === 'composer-2.5-fast')?.displayName).toMatch(/Fast/i);
    expect(models[0]?.maxContextSize).toBe(200_000);
    expect(models[0]?.capabilities).toContain('thinking');
  });

  it('falls back to the model name when variants are missing', () => {
    const models = normalizeAvailableModels([
      {
        name: 'grok-code-fast-1',
        clientDisplayName: 'Grok Code Fast 1',
        supportsThinking: false,
        supportsImages: false,
      },
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'grok-code-fast-1',
      displayName: 'Grok Code Fast 1',
      capabilities: ['tool_use'],
    });
  });

  it('keeps cursor- prefix on Grok slugs for Run', () => {
    const models = normalizeAvailableModels([
      {
        name: 'cursor-grok-4.5',
        clientDisplayName: 'Cursor Grok 4.5',
        serverModelName: 'cursor-grok-4.5',
        supportsThinking: true,
        supportsImages: false,
        variants: [
          {
            legacySlug: 'cursor-grok-4.5-high-fast',
            displayName: 'Cursor Grok 4.5 High',
            isDefaultNonMaxConfig: true,
            parameterValues: [
              { id: 'effort', value: 'high' },
              { id: 'fast', value: 'true' },
            ],
          },
        ],
      },
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('cursor-grok-4.5-high-fast');
    expect(models[0]?.serverModelId).toBe('cursor-grok-4.5');
  });

  it('keeps the preferred variant when duplicate slugs appear', () => {
    const models = normalizeAvailableModels([
      {
        name: 'claude-4.6-sonnet',
        variants: [
          {
            legacySlug: 'claude-4.6-sonnet',
            displayName: 'Sonnet (max)',
            isDefaultMaxConfig: true,
            parameterValues: [],
          },
          {
            legacySlug: 'claude-4.6-sonnet',
            displayName: 'Sonnet',
            isDefaultNonMaxConfig: true,
            parameterValues: [],
          },
        ],
      },
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]?.displayName).toBe('Sonnet');
  });
});

describe('toCursorCatalogModelId / decodeUsableModelIds', () => {
  it('normalizes discovery ids the way Run expects', () => {
    expect(toCursorCatalogModelId('cursor-grok-4.5-high-fast')).toBe('cursor-grok-4.5-high-fast');
    expect(toCursorCatalogModelId('grok-4.5-high-fast')).toBe('cursor-grok-4.5-high-fast');
    expect(toCursorCatalogModelId('grok-4.5-fast-high')).toBe('cursor-grok-4.5-high-fast');
    expect(toCursorCatalogModelId('auto')).toBe('default');
    expect(toCursorCatalogModelId('composer-2.5')).toBe('composer-2.5');
  });

  it('decodes GetUsableModelsResponse model_id fields', () => {
    const response = Buffer.concat([
      pbLen(1, pbStr(1, 'cursor-grok-4.5-high')),
      pbLen(1, pbStr(1, 'composer-2.5')),
    ]);
    expect(decodeUsableModelIds(new Uint8Array(response))).toEqual([
      'cursor-grok-4.5-high',
      'composer-2.5',
    ]);
  });

  it('reuses fallback capabilities for id-only usable-model responses', () => {
    expect(cursorUsableModelToDiscoveredModel('grok-code-fast-1')).toMatchObject({
      capabilities: ['tool_use'],
      maxContextSize: 128_000,
    });
    expect(cursorUsableModelToDiscoveredModel('gpt-5.4-medium')).toMatchObject({
      capabilities: ['thinking', 'tool_use'],
      displayName: 'GPT-5.4 (medium)',
      maxContextSize: 272_000,
    });
  });
});

describe('cursorModelsToPresets / applyCursorOAuthModelAliases', () => {
  it('maps fallback models into profile presets', () => {
    const presets = cursorModelsToPresets(CURSOR_FALLBACK_MODELS);
    expect(presets.length).toBeGreaterThan(5);
    expect(presets.some((p) => p.id === 'default')).toBe(true);
    expect(presets.find((p) => p.id === 'default')?.displayName).toBe('Auto');
    expect(presets.some((p) => p.id === 'composer-2.5')).toBe(true);
    expect(presets.find((p) => p.id === 'gpt-5.4-medium')).toMatchObject({
      displayName: 'GPT-5.4 (medium)',
      supportEfforts: [],
      defaultEffort: 'medium',
    });
  });

  it('replaces cursor-oauth aliases without touching other providers', () => {
    const config: { models?: Record<string, unknown> } = {
      models: {
        'cursor-oauth/composer-1': {
          provider: 'cursor-oauth',
          model: 'composer-1',
          maxContextSize: 100,
        },
        'xai-grok/grok-4': {
          provider: 'xai-grok',
          model: 'grok-4',
          maxContextSize: 256_000,
        },
      },
    };

    applyCursorOAuthModelAliases(config, [
      {
        id: 'composer-2.5',
        displayName: 'Composer 2.5',
        maxContextSize: 200_000,
        capabilities: ['thinking', 'tool_use'],
      },
    ]);

    expect(config.models?.['cursor-oauth/composer-1']).toBeUndefined();
    expect(config.models?.['cursor-oauth/composer-2.5']).toMatchObject({
      provider: 'cursor-oauth',
      model: 'composer-2.5',
      maxContextSize: 200_000,
      supportEfforts: [],
    });
    expect(config.models?.['xai-grok/grok-4']).toBeDefined();
  });
});

function pbStr(field: number, value: string): Buffer {
  return pbLen(field, Buffer.from(value, 'utf8'));
}

function pbLen(field: number, payload: Buffer): Buffer {
  const tag = Buffer.from(encodeVarint((field << 3) | 2));
  const len = Buffer.from(encodeVarint(payload.length));
  return Buffer.concat([tag, len, payload]);
}

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}
