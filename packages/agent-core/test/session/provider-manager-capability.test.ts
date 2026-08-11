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
