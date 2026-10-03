import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveModelCapabilities } from '../../src/session/provider/provider-manager-capability';
import { clearModelsDevCacheForTests, setModelsDevDataForTests } from '../../src/utils/model-metadata';

describe('resolveModelCapabilities', () => {
  beforeEach(clearModelsDevCacheForTests);
  afterEach(clearModelsDevCacheForTests);

  it('merges positive native metadata without reducing configured context', () => {
    setModelsDevDataForTests({ models: new Map([
      ['native-model', { supportsVision: true, supportsTools: true, supportsReasoning: true }],
    ]) });
    const caps = resolveModelCapabilities({
      provider: 'native', model: 'native-model', maxContextSize: 500000,
      capabilities: ['tool_use'],
    }, { type: 'openai', model: 'native-model', apiKey: 'key' });
    expect(caps.image_in).toBe(true);
    expect(caps.tool_use).toBe(true);
    expect(caps.thinking).toBe(true);
    expect(caps.max_context_tokens).toBe(500000);
  });

  it('never imposes harness pricing or thought-window ceilings on advertised windows', () => {
    for (const model of ['grok-4.6', 'gemini-3.1-pro', 'gpt-5.4', 'minimax-m3', 'qwen3.7-plus']) {
      const caps = resolveModelCapabilities({
        provider: 'native', model, maxContextSize: 1000000,
      }, { type: 'openai', model, apiKey: 'key' });
      expect(caps.max_context_tokens).toBe(1000000);
    }
  });

  it('preserves explicit per-kind input and reasoning capabilities', () => {
    const caps = resolveModelCapabilities({
      provider: 'native', model: 'custom-model', maxContextSize: 16384,
      capabilities: ['image_in', 'video_in', 'audio_in', 'pdf_in', 'thinking', 'tool_use'],
    }, { type: 'openai', model: 'custom-model', apiKey: 'key' });
    expect(caps).toMatchObject({ image_in: true, video_in: true, audio_in: true,
      pdf_in: true, thinking: true, tool_use: true, max_context_tokens: 16384 });
  });

  it('does not invent vision when the wire and model declarations omit it', () => {
    setModelsDevDataForTests({ models: new Map([
      ['unknown-model', { supportsVision: false, supportsTools: true }],
    ]) });
    const caps = resolveModelCapabilities({
      provider: 'native', model: 'unknown-model', maxContextSize: 16384,
      capabilities: ['tool_use'],
    }, { type: 'openai', model: 'unknown-model', apiKey: 'key' });
    expect(caps.image_in).toBe(false);
  });
});
