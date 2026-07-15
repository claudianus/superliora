import { describe, expect, it } from 'vitest';

import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_QUALITY_HYPE_VISUAL_FLOOD,
} from '../../src/premium-quality/quality-hype';
import { PREMIUM_QUALITY_FULL_GUIDANCE, PREMIUM_QUALITY_SPARSE_GUIDANCE } from '../../src/premium-quality/guidance';

describe('Premium Quality hype injection', () => {
  it('keeps compact quality pressure in full guidance', () => {
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_BANNER);
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('PREMIUM QUALITY MODE');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('screenshot-proof');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('principal designer');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('illegally good');
  });

  it('includes the quality bar block', () => {
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('principal designer');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_MANTRA);
  });

  it('keeps sparse turns quality-pressured without synonym floods', () => {
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_SPARSE);
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain('screenshot-proof');
    expect(PREMIUM_QUALITY_HYPE_SPARSE.length).toBeLessThan(220);
  });

  it('visual directives ban placeholder geometry without hype floods', () => {
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('primitive placeholder geometry');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('hierarchy, spacing, motion');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD.length).toBeLessThan(400);
  });
});
