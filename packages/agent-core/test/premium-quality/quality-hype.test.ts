import { describe, expect, it } from 'vitest';

import {
  PREMIUM_QUALITY_HYPE_BANNER,
  PREMIUM_QUALITY_HYPE_MANTRA,
  PREMIUM_QUALITY_HYPE_SPARSE,
  PREMIUM_QUALITY_HYPE_VISUAL_FLOOD,
} from '../../src/premium-quality/quality-hype';
import { PREMIUM_QUALITY_FULL_GUIDANCE, PREMIUM_QUALITY_SPARSE_GUIDANCE } from '../../src/premium-quality/guidance';

describe('Premium Quality hype injection', () => {
  it('keeps craft pressure without award-bait scope inflate', () => {
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_BANNER);
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('Premium Quality is ON');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('screenshot-proof');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('principal designer');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('do not expand scope for spectacle');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).not.toContain('KING-GOD-GENERAL');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).not.toContain('illegally good');
  });

  it('includes the quality mantra block', () => {
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('Quality mantra');
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('ZERO-SLOP');
    expect(PREMIUM_QUALITY_HYPE_MANTRA).toContain('iterate craft inside the stated scope');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_QUALITY_HYPE_MANTRA);
  });

  it('keeps sparse turns quality-pressured without synonym flood', () => {
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain('Premium Quality still ON');
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).not.toContain(PREMIUM_QUALITY_HYPE_SPARSE);
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE.length).toBeLessThan(280);
  });

  it('visual craft directives ban placeholder geometry without war-crime hype', () => {
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('wireframe');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('Heroes:');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('cohesive art direction');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).toContain('hierarchy');
    expect(PREMIUM_QUALITY_HYPE_VISUAL_FLOOD).not.toContain('war crime');
  });
});
