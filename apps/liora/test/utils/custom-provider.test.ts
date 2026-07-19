import { describe, expect, it } from 'vitest';

import {
  applyCustomEndpointProvider,
  inferCustomEndpointFromUrl,
} from '#/utils/custom-provider';
import type { LioraConfig } from '@superliora/sdk';

function emptyConfig(): LioraConfig {
  return {
    providers: {},
    models: {},
  } as LioraConfig;
}

describe('inferCustomEndpointFromUrl', () => {
  it('infers openai_responses from /v1/responses and strips the route', () => {
    expect(inferCustomEndpointFromUrl('http://127.0.0.1:10100/v1/responses')).toEqual({
      baseUrl: 'http://127.0.0.1:10100/v1',
      providerType: 'openai_responses',
    });
  });

  it('infers openai from /v1/chat/completions', () => {
    expect(
      inferCustomEndpointFromUrl('https://api.example.test/v1/chat/completions/'),
    ).toEqual({
      baseUrl: 'https://api.example.test/v1',
      providerType: 'openai',
    });
  });

  it('infers anthropic from /v1/messages and strips /v1 for the SDK base', () => {
    expect(inferCustomEndpointFromUrl('http://127.0.0.1:10100/v1/messages')).toEqual({
      baseUrl: 'http://127.0.0.1:10100',
      providerType: 'anthropic',
    });
  });

  it('leaves plain /v1 bases unchanged without a type', () => {
    expect(inferCustomEndpointFromUrl('http://127.0.0.1:10100/v1/')).toEqual({
      baseUrl: 'http://127.0.0.1:10100/v1',
    });
  });
});

describe('applyCustomEndpointProvider', () => {
  it('uses inferred wire type when providerType is omitted', () => {
    const config = emptyConfig();
    applyCustomEndpointProvider(config, {
      providerId: 'ocx',
      baseUrl: 'http://127.0.0.1:10100/v1/responses',
      modelId: 'cursor/grok-4.5',
      setDefault: true,
    });
    expect(config.providers['ocx']?.type).toBe('openai_responses');
    expect(config.providers['ocx']?.baseUrl).toBe('http://127.0.0.1:10100/v1');
    expect(config.defaultModel).toBe('ocx/cursor/grok-4.5');
  });

  it('keeps an explicit providerType over URL inference', () => {
    const config = emptyConfig();
    applyCustomEndpointProvider(config, {
      providerId: 'ocx',
      baseUrl: 'http://127.0.0.1:10100/v1/responses',
      modelId: 'cursor/grok-4.5',
      providerType: 'openai',
    });
    expect(config.providers['ocx']?.type).toBe('openai');
    expect(config.providers['ocx']?.baseUrl).toBe('http://127.0.0.1:10100/v1');
  });
});
