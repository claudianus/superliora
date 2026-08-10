import { describe, expect, it } from 'vitest';

import {
  mediaReadinessFromEnv,
  renderMediaReadiness,
} from '../../../src/agent/injection/media-readiness';
import type { MediaProviderEnv } from '../../../src/tools/builtin/media/provider-env';

describe('media readiness injection', () => {
  it('renders ready image+video guidance with backend ids', () => {
    const text = renderMediaReadiness({
      image: true,
      video: true,
      imageProviders: ['xai', 'openai'],
      videoProviders: ['xai'],
    });
    expect(text).toContain('<media_readiness>');
    expect(text).toContain('GenerateImage=ready (xai|openai)');
    expect(text).toContain('GenerateVideo=ready (xai)');
    expect(text).toContain('success_criteria');
    expect(text).toContain('do not claim the harness cannot draw');
    expect(text).toContain('provider=auto');
    expect(text).toContain('Do not force qwen/openai/google');
    expect(text).not.toContain('do not brief native Generate* as guaranteed');
    expect(text).toContain('</media_readiness>');
  });

  it('renders missing guidance with key hints', () => {
    const text = renderMediaReadiness({
      image: false,
      video: false,
      imageProviders: [],
      videoProviders: [],
    });
    expect(text).toContain('GenerateImage=missing');
    expect(text).toContain('GenerateVideo=missing');
    expect(text).toContain('do not brief native Generate* as guaranteed');
    expect(text).toContain('OPENAI_API_KEY');
    expect(text).not.toContain('do not claim the harness cannot draw');
  });

  it('renders mixed readiness with both ready and missing guidance', () => {
    const text = renderMediaReadiness({
      image: true,
      video: false,
      imageProviders: ['xai'],
      videoProviders: [],
    });
    expect(text).toContain('GenerateImage=ready (xai)');
    expect(text).toContain('GenerateVideo=missing');
    expect(text).toContain('do not claim the harness cannot draw');
    expect(text).toContain('do not brief native Generate* as guaranteed');
  });

  it('derives snapshot from env via availability SSOT', () => {
    const empty: MediaProviderEnv = {};
    expect(mediaReadinessFromEnv(empty)).toEqual({
      image: false,
      video: false,
      imageProviders: [],
      videoProviders: [],
    });

    const withOpenai: MediaProviderEnv = { openaiApiKey: 'sk-test' };
    const snap = mediaReadinessFromEnv(withOpenai);
    expect(snap.image).toBe(true);
    expect(snap.imageProviders).toEqual(['openai']);
    // OpenAI alone does not enable video in current providers.
    expect(typeof snap.video).toBe('boolean');
  });
});
