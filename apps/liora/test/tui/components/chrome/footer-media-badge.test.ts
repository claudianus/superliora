import { afterEach, describe, expect, it } from 'vitest';

import {
  formatMediaFooterBadge,
  formatWebFooterBadge,
  formatZdrFooterBadge,
  mediaImageKeyReady,
  mediaVideoKeyReady,
} from '#/tui/components/chrome/footer';

const KEYS = ['OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'SUPERLIORA_TELEMETRY', 'TELEMETRY'] as const;

describe('footer media readiness badges', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  function clearKeys(): void {
    for (const key of KEYS) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  }

  it('reports img when only OpenAI key is present', () => {
    clearKeys();
    process.env['OPENAI_API_KEY'] = 'sk-test';
    expect(mediaImageKeyReady()).toBe(true);
    expect(mediaVideoKeyReady()).toBe(false);
    expect(formatMediaFooterBadge()?.label).toBe('img');
  });

  it('reports img·vid when image and video keys are present', () => {
    clearKeys();
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['GOOGLE_API_KEY'] = 'g-test';
    expect(formatMediaFooterBadge()?.label).toBe('img·vid');
  });

  it('returns null when no media keys exist', () => {
    clearKeys();
    expect(formatMediaFooterBadge()).toBeNull();
  });
});

describe('footer ZDR readiness badges', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['SUPERLIORA_TELEMETRY', 'TELEMETRY'] as const) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  function clearTelemetry(): void {
    for (const key of ['SUPERLIORA_TELEMETRY', 'TELEMETRY'] as const) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  }

  it('defaults to zdr when telemetry is unset', () => {
    clearTelemetry();
    expect(formatZdrFooterBadge()?.label).toBe('zdr');
  });

  it('reports tel when SUPERLIORA_TELEMETRY is on', () => {
    clearTelemetry();
    process.env['SUPERLIORA_TELEMETRY'] = '1';
    expect(formatZdrFooterBadge()?.label).toBe('tel');
  });
});

describe('footer web readiness badges', () => {
  it('always reports web for built-in research tools', () => {
    expect(formatWebFooterBadge().label).toBe('web');
    expect(formatWebFooterBadge().severity).toBe('info');
  });
});
