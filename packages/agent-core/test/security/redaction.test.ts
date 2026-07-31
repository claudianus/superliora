import { describe, expect, it } from 'vitest';

import { REDACTED_SECRET, redactSecretsInText } from '#/security/redaction';

describe('redactSecretsInText', () => {
  it('masks sk-* API keys', () => {
    const { text, redactions } = redactSecretsInText('key=sk-abcdefghijklmnopqrstuvwxyz');
    expect(text).toContain(REDACTED_SECRET);
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(redactions).toBeGreaterThan(0);
  });

  it('masks Bearer tokens', () => {
    const { text } = redactSecretsInText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('masks Google AIza* keys', () => {
    const { text } = redactSecretsInText('GOOGLE_API_KEY=AIzaSyD-example-key-should-vanish');
    expect(text).toContain(REDACTED_SECRET);
    expect(text).not.toContain('AIzaSyD-example-key-should-vanish');
  });

  it('leaves benign text unchanged', () => {
    const input = 'grep finished · 3 matches · no secrets here';
    expect(redactSecretsInText(input)).toEqual({ text: input, redactions: 0 });
  });
});
