import { describe, expect, it } from 'vitest';

import {
  PREMIUM_VISUAL_COMPONENT_LIBRARIES,
  PREMIUM_VISUAL_INSPIRATION_SITES,
  PREMIUM_VISUAL_PHOTO_CATALOG,
  PREMIUM_VISUAL_REFERENCE_CATALOG,
  PREMIUM_VISUAL_REFERENCE_COMPACT,
} from '../../src/premium-quality/references';

describe('Premium Visual reference catalog', () => {
  it('embeds curated inspiration URLs', () => {
    expect(PREMIUM_VISUAL_INSPIRATION_SITES).toContain('https://godly.website/');
    expect(PREMIUM_VISUAL_INSPIRATION_SITES).toContain('https://www.awwwards.com/');
    expect(PREMIUM_VISUAL_INSPIRATION_SITES).toContain('https://bentogrids.com/');
  });

  it('embeds reliable photo and avatar URL patterns', () => {
    expect(PREMIUM_VISUAL_PHOTO_CATALOG).toContain('picsum.photos/seed/');
    expect(PREMIUM_VISUAL_PHOTO_CATALOG).toContain('api.dicebear.com/10.x/');
    expect(PREMIUM_VISUAL_PHOTO_CATALOG).toContain('.webp');
  });

  it('embeds premium component library sources', () => {
    expect(PREMIUM_VISUAL_COMPONENT_LIBRARIES).toContain('https://ui.aceternity.com/');
    expect(PREMIUM_VISUAL_COMPONENT_LIBRARIES).toContain('https://magicui.design/');
    expect(PREMIUM_VISUAL_COMPONENT_LIBRARIES).toContain('https://reactbits.dev/');
  });

  it('is included in the full reference catalog block', () => {
    expect(PREMIUM_VISUAL_REFERENCE_CATALOG).toContain('Design inspiration');
    expect(PREMIUM_VISUAL_REFERENCE_CATALOG).toContain('Pre-ship self-critique');
    expect(PREMIUM_VISUAL_REFERENCE_CATALOG).toContain('fonts.googleapis.com');
  });

  it('keeps a compact injection pointer with the highest-value refs', () => {
    expect(PREMIUM_VISUAL_REFERENCE_COMPACT).toContain('godly.website');
    expect(PREMIUM_VISUAL_REFERENCE_COMPACT).toContain('picsum.photos/seed/');
    expect(PREMIUM_VISUAL_REFERENCE_COMPACT.length).toBeLessThan(PREMIUM_VISUAL_REFERENCE_CATALOG.length / 2);
  });

  it('documents that the full catalog is offline-only, not the injection hot path', () => {
    // Hot path: visual-harness imports COMPACT only. Full catalog remains exported for offline use/tests.
    expect(PREMIUM_VISUAL_REFERENCE_CATALOG.length).toBeGreaterThan(PREMIUM_VISUAL_REFERENCE_COMPACT.length * 2);
  });
});
