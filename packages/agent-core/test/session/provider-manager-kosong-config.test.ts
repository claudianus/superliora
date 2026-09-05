import { describe, expect, it } from 'vitest';

import type { ProviderConfig } from '../../src/config/schema';
import { toKosongProviderConfig } from '../../src/session/provider/provider-manager-kosong-config';

function call(provider: ProviderConfig, model = 'gemini-2.5-flash') {
  return toKosongProviderConfig(
    provider,
    model,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
}

describe('toKosongProviderConfig google branches', () => {
  it('maps google-genai baseUrl + customHeaders (proxy endpoints)', () => {
    const config = call({
      type: 'google-genai',
      apiKey: 'sk-test',
      baseUrl: 'https://gateway.example.test/v1beta',
      customHeaders: { 'x-tenant': 'acme' },
    });
    expect(config).toMatchObject({
      type: 'google-genai',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://gateway.example.test/v1beta',
      defaultHeaders: { 'x-tenant': 'acme' },
    });
  });

  it('omits defaultHeaders for google-genai when none are configured', () => {
    const config = call({ type: 'google-genai', apiKey: 'sk-test' });
    expect(config).toMatchObject({ type: 'google-genai' });
    expect('defaultHeaders' in config).toBe(false);
  });

  it('passes a configured vertexai baseUrl through (regional endpoints)', () => {
    const config = call({
      type: 'vertexai',
      baseUrl: 'https://us-central1-aiplatform.googleapis.com',
      env: { GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CLOUD_LOCATION: 'us-central1' },
    });
    expect(config).toMatchObject({
      type: 'vertexai',
      vertexai: true,
      baseUrl: 'https://us-central1-aiplatform.googleapis.com',
    });
  });

  it('leaves vertexai baseUrl unset by default (SDK/ADC defaults)', () => {
    const config = call({
      type: 'vertexai',
      env: { GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CLOUD_LOCATION: 'us-central1' },
    });
    expect(config).toMatchObject({ type: 'vertexai', vertexai: true });
    expect('baseUrl' in config).toBe(false);
  });
});

function callOpenAI(provider: ProviderConfig, promptCacheKey?: string) {
  return toKosongProviderConfig(
    provider,
    'grok-4.6',
    undefined,
    undefined,
    undefined,
    undefined,
    promptCacheKey,
    undefined,
    undefined,
  );
}

describe('toKosongProviderConfig OpenCode session headers', () => {
  it('injects x-opencode-session from promptCacheKey for OpenCode Zen endpoints', () => {
    const config = callOpenAI(
      { type: 'openai', apiKey: 'sk-test', baseUrl: 'https://opencode.ai/zen/v1' },
      'sess-123',
    );
    expect(config).toMatchObject({
      type: 'openai',
      defaultHeaders: { 'x-opencode-session': 'sess-123' },
    });
  });

  it('injects x-opencode-session for OpenCode Go endpoints', () => {
    const config = callOpenAI(
      { type: 'openai', apiKey: 'sk-test', baseUrl: 'https://opencode.ai/zen/go/v1' },
      'sess-456',
    );
    expect(config).toMatchObject({
      type: 'openai',
      defaultHeaders: { 'x-opencode-session': 'sess-456' },
    });
  });

  it('omits the session header when no promptCacheKey is available', () => {
    const config = callOpenAI({
      type: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://opencode.ai/zen/v1',
    });
    expect('defaultHeaders' in config).toBe(false);
  });

  it('lets customHeaders override the injected session header', () => {
    const config = callOpenAI(
      {
        type: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://opencode.ai/zen/v1',
        customHeaders: { 'x-opencode-session': 'user-configured' },
      },
      'sess-123',
    );
    expect(config).toMatchObject({
      type: 'openai',
      defaultHeaders: { 'x-opencode-session': 'user-configured' },
    });
  });

  it('does not inject the session header for non-OpenCode endpoints', () => {
    const config = callOpenAI(
      { type: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.example.test/v1' },
      'sess-123',
    );
    expect('defaultHeaders' in config).toBe(false);
  });

  it('covers openai_responses wires pointing at OpenCode Zen', () => {
    const config = toKosongProviderConfig(
      { type: 'openai', apiKey: 'sk-test', baseUrl: 'https://opencode.ai/zen/v1' },
      'some-model',
      'openai_responses',
      undefined,
      undefined,
      undefined,
      'sess-789',
      undefined,
      undefined,
    );
    expect(config).toMatchObject({
      type: 'openai_responses',
      defaultHeaders: { 'x-opencode-session': 'sess-789' },
    });
  });

  it('covers anthropic wires pointing at OpenCode Zen', () => {
    const config = toKosongProviderConfig(
      { type: 'openai', apiKey: 'sk-test', baseUrl: 'https://opencode.ai/zen' },
      'some-model',
      'anthropic',
      undefined,
      undefined,
      undefined,
      'sess-321',
      undefined,
      undefined,
    );
    expect(config).toMatchObject({
      type: 'anthropic',
      defaultHeaders: { 'x-opencode-session': 'sess-321' },
    });
  });
});
