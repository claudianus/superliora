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
