import { describe, expect, it } from 'vitest';

import { captureRetryPolicyForScenario } from '../../../../scripts/liora-tui-capture-retry-policy.mjs';

describe('TUI capture retry policy', () => {
  it('adds bounded recapture for slash-command autocomplete evidence', () => {
    expect(captureRetryPolicyForScenario('autocomplete')).toEqual({
      maxAttempts: 3,
      retryDelayMs: 650,
      recoveryKeys: ['Tab'],
      reason: 'Slash-command suggestions can appear one render tick after the first Tab in tmux captures.',
    });
  });

  it('keeps ordinary scenarios single-shot so real regressions stay visible', () => {
    expect(captureRetryPolicyForScenario('help')).toBeUndefined();
    expect(captureRetryPolicyForScenario('status')).toBeUndefined();
    expect(captureRetryPolicyForScenario('prompt-entry')).toBeUndefined();
  });
});
