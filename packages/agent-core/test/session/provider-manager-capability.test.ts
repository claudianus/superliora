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

  it('caps Gemini Pro advertised windows at the 200k price band', () => {
    const caps = resolveModelCapabilities(
      {
        provider: 'google-genai',
        model: 'gemini-3.1-pro',
        maxContextSize: 1_000_000,
        capabilities: ['thinking', 'tool_use', 'image_in'],
      },
      { type: 'google-genai', model: 'gemini-3.1-pro', apiKey: 'sk-test' },
    );
    expect(caps.max_context_tokens).toBe(200_000);
  });

  it('caps GPT-5.4 advertised windows at the 272k price band', () => {
    const caps = resolveModelCapabilities(
      {
        provider: 'openai',
        model: 'gpt-5.4',
        maxContextSize: 1_050_000,
        capabilities: ['thinking', 'tool_use'],
      },
      { type: 'openai', model: 'gpt-5.4', apiKey: 'sk-test' },
    );
    expect(caps.max_context_tokens).toBe(272_000);
  });

  it('caps MiniMax M3 advertised windows at the 512k price band', () => {
    const caps = resolveModelCapabilities(
      {
        provider: 'clinepass',
        model: 'cline-pass/minimax-m3',
        maxContextSize: 1_048_576,
        capabilities: ['thinking', 'tool_use'],
      },
      { type: 'openai', model: 'cline-pass/minimax-m3', apiKey: 'sk-test' },
    );
    expect(caps.max_context_tokens).toBe(512_000);
  });

  it('caps Qwen Plus advertised windows at the 256k price band', () => {
    const caps = resolveModelCapabilities(
      {
        provider: 'qwen-oauth',
        model: 'qwen3.7-plus',
        maxContextSize: 1_000_000,
        capabilities: ['thinking', 'tool_use', 'image_in'],
      },
      { type: 'openai', model: 'qwen3.7-plus', apiKey: 'sk-test' },
    );
    expect(caps.max_context_tokens).toBe(256_000);
  });

  it('does not cap Claude 4.6 or Gemini Flash advertised windows', () => {
    expect(
      resolveModelCapabilities(
        {
          provider: 'anthropic',
          model: 'claude-4.6-sonnet',
          maxContextSize: 1_000_000,
          capabilities: ['thinking', 'tool_use'],
        },
        { type: 'anthropic', model: 'claude-4.6-sonnet', apiKey: 'sk-test' },
      ).max_context_tokens,
    ).toBe(1_000_000);
    expect(
      resolveModelCapabilities(
        {
          provider: 'google-genai',
          model: 'gemini-3.5-flash',
          maxContextSize: 1_000_000,
          capabilities: ['thinking', 'tool_use', 'image_in'],
        },
        { type: 'google-genai', model: 'gemini-3.5-flash', apiKey: 'sk-test' },
      ).max_context_tokens,
    ).toBe(1_000_000);
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
