import { describe, expect, it } from 'vitest';

import {
  PREMIUM_VISUAL_BANNED_SHIP_STATES,
  PREMIUM_VISUAL_HARNESS,
  PREMIUM_VISUAL_RUBRIC,
} from '../../src/premium-quality/visual-harness';
import {
  PREMIUM_QUALITY_FULL_GUIDANCE,
  PREMIUM_QUALITY_SPARSE_GUIDANCE,
} from '../../src/premium-quality/guidance';
import { PREMIUM_VISUAL_SKILL_ROUTING } from '../../src/premium-quality/contract';

describe('Premium Visual harness', () => {
  it('includes supremacy mandate, art direction, and verification loop', () => {
    expect(PREMIUM_VISUAL_HARNESS).toContain('PREMIUM VISUAL');
    expect(PREMIUM_VISUAL_HARNESS).toContain('Art direction before code');
    expect(PREMIUM_VISUAL_HARNESS).toContain('Visual verification loop');
    expect(PREMIUM_VISUAL_HARNESS).toContain('Visual upgrade playbook');
  });

  it('bans placeholder geometry as final art', () => {
    expect(PREMIUM_VISUAL_BANNED_SHIP_STATES).toContain('primitive shapes as final art');
    expect(PREMIUM_VISUAL_BANNED_SHIP_STATES).toContain('without opening a real screenshot');
  });

  it('mandates SearchSkill visual skill routing', () => {
    expect(PREMIUM_VISUAL_SKILL_ROUTING).toContain('SearchSkill');
    expect(PREMIUM_VISUAL_SKILL_ROUTING).toContain('premium frontend design taste anti slop');
    expect(PREMIUM_VISUAL_SKILL_ROUTING).toContain('develop-web-game');
  });

  it('requires rubric score threshold before ship', () => {
    expect(PREMIUM_VISUAL_RUBRIC).toContain('ship only when all ≥ 4');
  });
});

describe('Premium Quality guidance composition', () => {
  it('embeds the full visual harness in full guidance', () => {
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('Premium Quality is ON');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('principal designer');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain(PREMIUM_VISUAL_HARNESS);
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('godly.website');
    expect(PREMIUM_QUALITY_FULL_GUIDANCE).toContain('picsum.photos/seed/');
    // Full premium injection is periodic — keep a hard size budget after hype collapse.
    expect(PREMIUM_QUALITY_FULL_GUIDANCE.length).toBeLessThan(6_400);
  });

  it('keeps sparse guidance visually assertive', () => {
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain('PRIMARY');
    expect(PREMIUM_QUALITY_SPARSE_GUIDANCE).toContain('BrowserScreenshot before done');
  });
});
