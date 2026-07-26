import { afterEach, describe, expect, it } from 'vitest';

import {
  isExperimentalFlagEnabled,
  setExperimentalFeatures,
} from '#/tui/commands/experimental-flags';

describe('experimental flags snapshot', () => {
  afterEach(() => {
    setExperimentalFeatures([]);
  });

  it('uses registry default for prompt_intelligence when snapshot is empty', () => {
    setExperimentalFeatures([]);
    expect(isExperimentalFlagEnabled('prompt_intelligence')).toBe(true);
  });

  it('respects explicit off in snapshot', () => {
    setExperimentalFeatures([{ id: 'prompt_intelligence', enabled: false }]);
    expect(isExperimentalFlagEnabled('prompt_intelligence')).toBe(false);
  });

  it('treats undefined flag as always-on (not gated)', () => {
    expect(isExperimentalFlagEnabled(undefined)).toBe(true);
  });
});
