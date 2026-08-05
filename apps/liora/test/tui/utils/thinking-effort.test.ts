import type { ModelAlias } from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  clampEffortToModel,
  defaultEffortForModel,
  effortsForModel,
  formatModelWithThinking,
  formatThinkingLevelSuffix,
  modelUsesEmbeddedThinkingEffort,
  providerThinkingFamily,
  resolveThinkingDisplay,
  resolveThinkingLevelForApply,
  wireEffortForModel,
} from '#/tui/utils/model/thinking-effort';

function model(
  provider: string,
  options: {
    readonly supportEfforts?: readonly string[];
    readonly defaultEffort?: string;
    readonly protocol?: 'anthropic';
    readonly adaptiveThinking?: boolean;
  } = {},
): ModelAlias {
  return {
    provider,
    model: 'test-model',
    maxContextSize: 128_000,
    displayName: 'Test',
    capabilities: ['thinking'],
    ...(options.supportEfforts !== undefined ? { supportEfforts: options.supportEfforts } : {}),
    ...(options.defaultEffort !== undefined ? { defaultEffort: options.defaultEffort } : {}),
    ...(options.protocol !== undefined ? { protocol: options.protocol } : {}),
    ...(options.adaptiveThinking !== undefined
      ? { adaptiveThinking: options.adaptiveThinking }
      : {}),
  } as unknown as ModelAlias;
}

describe('thinking-effort utils', () => {
  it('classifies provider families', () => {
    expect(providerThinkingFamily('managed:kimi-api')).toBe('kimi');
    expect(providerThinkingFamily('openai')).toBe('openai');
    expect(providerThinkingFamily('anthropic')).toBe('anthropic');
    expect(providerThinkingFamily('google-gemini')).toBe('gemini');
    expect(providerThinkingFamily('my-custom-proxy')).toBe('unknown');
  });

  it('uses declared supportEfforts when present', () => {
    const m = model('managed:kimi-api', { supportEfforts: ['low', 'high', 'max'] });
    expect(effortsForModel(m)).toEqual(['low', 'high', 'max']);
    expect(defaultEffortForModel(m)).toBe('high');
  });

  it('does not replace an explicit empty effort list with provider defaults', () => {
    expect(effortsForModel(model('openai', { supportEfforts: [] }))).toEqual([]);
  });

  it('treats Cursor model ids as the source of reasoning strength', () => {
    const m = {
      ...model('cursor-oauth', { supportEfforts: [] }),
      model: 'gpt-5.4-medium',
    };
    expect(modelUsesEmbeddedThinkingEffort(m)).toBe(true);
    expect(effortsForModel(m)).toEqual([]);
    expect(formatThinkingLevelSuffix('high', { thinking: true, model: m })).toBe('');
    expect(formatModelWithThinking('GPT-5.4 (medium)', 'high', { thinking: true, model: m })).toBe(
      'GPT-5.4 (medium)',
    );
    expect(
      modelUsesEmbeddedThinkingEffort({
        provider: 'cursor-oauth',
        capabilities: ['tool_use'],
      }),
    ).toBe(false);
  });

  it('falls back to provider-aware defaults without supportEfforts', () => {
    expect(effortsForModel(model('managed:kimi-api'))).toEqual(['low', 'medium', 'high']);
    expect(effortsForModel(model('openai'))).toEqual(['low', 'medium', 'high', 'xhigh']);
    // Truly unknown custom endpoints (no openai/kimi marker) stay conservative.
    expect(effortsForModel(model('my-custom-proxy'))).toEqual(['low', 'medium', 'high']);
  });

  it('clamps unsupported efforts onto the model list', () => {
    const m = model('openai', { supportEfforts: ['low', 'high'] });
    expect(clampEffortToModel('max', m)).toBe('high');
    expect(clampEffortToModel('medium', m)).toBe('low');
    expect(clampEffortToModel('on', m)).toBe('high');
    expect(clampEffortToModel('off', m)).toBe('off');
  });

  it('maps wire efforts per provider family', () => {
    expect(wireEffortForModel('max', model('managed:kimi-api'))).toBe('high');
    expect(wireEffortForModel('xhigh', model('managed:kimi-api'))).toBe('high');
    expect(wireEffortForModel('max', model('openai'))).toBe('xhigh');
    expect(wireEffortForModel('high', model('openai'))).toBe('high');
    expect(
      wireEffortForModel(
        'max',
        model('managed:kimi-code', {
          supportEfforts: ['low', 'medium', 'high', 'max'],
          protocol: 'anthropic',
          adaptiveThinking: true,
        }),
      ),
    ).toBe('max');
  });

  it('builds transparent display labels when request ≠ wire', () => {
    // Kimi with declared max: request stays max, wire is high.
    const m = model('managed:kimi-api', { supportEfforts: ['low', 'high', 'max'] });
    expect(resolveThinkingDisplay('max', { thinking: true, model: m })).toEqual({
      requested: 'max',
      effective: 'high',
      label: 'max→high',
    });
    expect(formatThinkingLevelSuffix('max', { thinking: true, model: m })).toBe(' max→high');
    expect(formatModelWithThinking('Kimi K2', 'max', { thinking: true, model: m })).toBe(
      'Kimi K2 · max→high',
    );
  });

  it('resolves apply levels to concrete efforts', () => {
    const m = model('managed:kimi-api', { supportEfforts: ['low', 'high', 'max'] });
    expect(resolveThinkingLevelForApply(false, 'max', m)).toBe('off');
    expect(resolveThinkingLevelForApply(true, 'max', m)).toBe('max');
    expect(resolveThinkingLevelForApply(true, undefined, m)).toBe('high');
  });
});
