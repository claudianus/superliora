import { describe, expect, it } from 'vitest';

import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_QUALITY_HYPE_VISUAL_FLOOD,
} from '../../src/premium-quality/quality-hype';
import { PREMIUM_QUALITY_FULL_GUIDANCE, PREMIUM_QUALITY_SPARSE_GUIDANCE } from '../../src/premium-quality/guidance';

describe('Premium Quality hype injection', () => {
  it('floods full guidance with excessive quality adjectives', () => {
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_BANNER);
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('KING-GOD-GENERAL');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('god-tier');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('jaw-dropping');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('illegally good');
  });

  it('includes the quality mantra block', () => {
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('AWWWARDS-SITE-OF-THE-DAY');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_MANTRA);
  });

  it('keeps sparse turns hyper-pressured', () => {
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_SPARSE);
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain('GOD-TIER');
  });

  it('visual flood block is aggressively premium', () => {
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('visually-obscene');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('visually-obscene');
  });
});
