import { describe, expect, it, vi } from 'vitest';

import {
  detectUltraworkObjectiveProfileWithLlm,
  fallbackUltraworkObjectiveProfile,
  resolveUltraworkObjectiveProfile,
  shouldTrustUltraworkObjectiveProfile,
} from '../../src/ultrawork/objective-profile-llm';

describe('ultrawork objective profile classifier', () => {
  it('parses visual multi-lane profiles from the classifier response', async () => {
    const profile = await detectUltraworkObjectiveProfileWithLlm(
      {
        generate: vi.fn(async () => ({
          id: 'gen_test',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  visual_surface: true,
                  bench_surface: false,
                  premium_density: 'visual',
                  lanes: [
                    'product_requirements',
                    'architecture_implementation',
                    'domain_subject_matter',
                    'ux_visual_content',
                    'testing_evidence',
                    'integration_ownership',
                    'independent_review_loop',
                  ],
                  confidence: 0.92,
                  reason: 'Visible game surface with domain craft',
                }),
              },
            ],
          },
          usage: null,
          finishReason: 'stop',
          rawFinishReason: 'stop',
        })) as never,
        provider: {} as never,
      },
      { text: 'Build a polished Galaga browser game with visual QA' },
    );

    expect(profile?.visualSurface).toBe(true);
    expect(profile?.premiumDensity).toBe('visual');
    expect(profile?.lanes).toContain('ux_visual_content');
    expect(shouldTrustUltraworkObjectiveProfile(profile)).toBe(true);
  });

  it('falls back without keyword guessing when the classifier is unavailable', () => {
    const fallback = fallbackUltraworkObjectiveProfile(
      'Redesign the dashboard UI with browser screenshots',
    );
    expect(fallback.source).toBe('fallback');
    expect(fallback.visualSurface).toBe(false);
    expect(fallback.premiumDensity).toBe('code');
    expect(fallback.lanes).toEqual([
      'product_requirements',
      'architecture_implementation',
      'testing_evidence',
      'integration_ownership',
    ]);
    expect(resolveUltraworkObjectiveProfile(undefined, 'anything')).toMatchObject({
      source: 'fallback',
    });
  });

  it('rejects low-confidence profiles', async () => {
    const low = await detectUltraworkObjectiveProfileWithLlm(
      {
        generate: vi.fn(async () => ({
          id: 'gen_test',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '{"visual_surface":true,"bench_surface":false,"premium_density":"visual","lanes":["ux_visual_content"],"confidence":0.2,"reason":"guess"}',
              },
            ],
          },
          usage: null,
          finishReason: 'stop',
          rawFinishReason: 'stop',
        })) as never,
        provider: {} as never,
      },
      { text: 'maybe visual?' },
    );
    expect(shouldTrustUltraworkObjectiveProfile(low)).toBe(false);
    expect(resolveUltraworkObjectiveProfile(low, 'maybe visual?').source).toBe('fallback');
  });
});
