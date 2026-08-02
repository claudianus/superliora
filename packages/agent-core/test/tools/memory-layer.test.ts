import { describe, expect, it } from 'vitest';

import {
  MEMORY_LAYER_TAGS,
  mergeLayerTag,
} from '../../src/tools/builtin/state/memory';

describe('Memory instruction vs learning layer tags', () => {
  it('defaults merge with learning tag first', () => {
    expect(mergeLayerTag(undefined, MEMORY_LAYER_TAGS.learning)).toEqual([
      'layer:learning',
    ]);
  });

  it('prepends instruction layer and drops conflicting layer tags', () => {
    expect(
      mergeLayerTag(
        ['layer:learning', 'pref', 'layer:instruction'],
        MEMORY_LAYER_TAGS.instruction,
      ),
    ).toEqual(['layer:instruction', 'pref']);
  });

  it('keeps user tags after layer tag', () => {
    expect(mergeLayerTag(['api', 'prefs'], MEMORY_LAYER_TAGS.learning)).toEqual([
      'layer:learning',
      'api',
      'prefs',
    ]);
  });
});
