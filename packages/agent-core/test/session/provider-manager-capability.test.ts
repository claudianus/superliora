import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveModelCapabilities } from '../../src/session/provider/provider-manager-capability';
import {
  clearModelsDevCacheForTests,
  setModelsDevDataForTests,
} from '../../src/utils/model-presets';

describe('resolveModelCapabilities', () => {
  beforeEach(() => {
    clearModelsDevCacheForTests();
  });
  afterEach(() => {
    clearModelsDevCacheForTests();
  });

  it('lets models.dev vision win over a stale partial capabilities list', () => {
    setModelsDevDataForTests({
      models: new Map([
        ['grok-4.5', { supportsVision: true, supportsTools: true, supportsReasoning: true }],
      ]),
    });

    const caps = resolveModelCapabilities(
      {
        provider: 'xai-grok',
        model: 'grok-4.5',
        maxContextSize: 500_000,
        capabilities: ['thinking', 'tool_use'],
      },
      { type: 'openai', model: 'grok-4.5', apiKey: 'sk-test' },
    );

    expect(caps.image_in).toBe(true);
    expect(caps.tool_use).toBe(true);
    expect(caps.thinking).toBe(true);
    expect(caps.max_context_tokens).toBe(200_000);
  });

  it('caps Grok advertised windows at the xAI 200k price band', () => {
    const caps = resolveModelCapabilities(
      {
        provider: 'xai-grok',
        model: 'grok-4.6',
        maxContextSize: 500_000,
        capabilities: ['thinking', 'tool_use', 'image_in'],
      },
      { type: 'openai', model: 'grok-4.6', apiKey: 'sk-test' },
    );
    expect(caps.max_context_tokens).toBe(200_000);
  });

  it('does not raise a smaller Grok window to 200k', () => {
    const caps = resolveModelCapabilities(
      {
        provider: 'cursor-oauth',
        model: 'grok-code-fast-1',
        maxContextSize: 128_000,
        capabilities: ['tool_use'],
      },
      { type: 'openai', model: 'grok-code-fast-1', apiKey: 'sk-test' },
    );
    expect(caps.max_context_tokens).toBe(128_000);
  });

  it('does not invent vision when models.dev and declarations omit it', () => {
    setModelsDevDataForTests({
      models: new Map([['grok-build-0.1', { supportsVision: false, supportsTools: true }]]),
    });

    const caps = resolveModelCapabilities(
      {
        provider: 'xai-grok',
        model: 'grok-build-0.1',
        capabilities: ['tool_use'],
      },
      { type: 'openai', model: 'grok-build-0.1', apiKey: 'sk-test' },
    );

    expect(caps.image_in).toBe(false);
  });
});
