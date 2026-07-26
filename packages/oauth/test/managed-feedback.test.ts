import { describe, expect, it } from 'vitest';

import { kimiCodeFeedbackUrl } from '../src/managed-feedback';

describe('oauth/managed-feedback — kimiCodeFeedbackUrl', () => {
  it('returns a feedback URL with a /v1/feedback suffix on the default host', () => {
    const url = new URL(kimiCodeFeedbackUrl());
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toMatch(/\/v1\/feedback\/?$/);
  });

  it('appends the feedback suffix to a custom https base URL', () => {
    const url = new URL(kimiCodeFeedbackUrl('https://example.test/api/v1/'));
    expect(url.origin).toBe('https://example.test');
    expect(url.pathname).toMatch(/\/v1\/feedback\/?$/);
  });

  it('preserves the host on a custom base URL', () => {
    const url = new URL(kimiCodeFeedbackUrl('https://api.kimi.com/coding/v1'));
    expect(url.host).toBe('api.kimi.com');
  });
});
