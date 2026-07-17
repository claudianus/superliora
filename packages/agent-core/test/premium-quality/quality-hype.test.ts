import { describe, expect, it } from 'vitest';

import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_QUALITY_HYPE_VISUAL_FLOOD,
} from '../../src/premium-quality/quality-hype';
import { PREMIUM_QUALITY_FULL_GUIDANCE, PREMIUM_QUALITY_SPARSE_GUIDANCE } from '../../src/premium-quality/guidance';

describe('Premium Quality hype injection', () => {
  it('restores deliberate synonym-flood quality pressure in full guidance', () => {
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_BANNER);
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('ULTRA SUPER PREMIUM KING-GOD-GENERAL');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('god-tier');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('screenshot-proof');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('principal designer');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('illegally good');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('bulldozer');
  });

  it('includes the quality mantra block', () => {
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('Quality mantra');
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('ZERO-SLOP');
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('illegally good');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_MANTRA);
  });

  it('keeps sparse turns quality-pressured with compact god-tier hype', () => {
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_SPARSE);
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain('ULTRA-SUPER-PREMIUM GOD-TIER');
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain('screenshot-proof');
    expect(PREMIUM_QUALITY_HYPE_SPARSE.length).toBeLessThan(280);
  });

  it('visual hype directives ban template cowardice and placeholder geometry vibes', () => {
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('war crime');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('Hero sections must hit like a truck');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('premium-juice VFX');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('hierarchy');
  });
});
