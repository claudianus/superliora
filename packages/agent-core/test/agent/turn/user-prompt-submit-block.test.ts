import { describe, expect, it } from 'vitest';

import {
  USER_PROMPT_SUBMIT_BLOCK_CODE,
  formatUserPromptSubmitBlockTip,
} from '../../../src/agent/turn/prompt-hook';

describe('UserPromptSubmit block tip (Loop41a)', () => {
  it('prefixes stable marker and wire code', () => {
    const tip = formatUserPromptSubmitBlockTip('policy denied');
    expect(tip.startsWith('USER_PROMPT_SUBMIT_BLOCK:')).toBe(true);
    expect(tip).toContain('policy denied');
    expect(tip).toContain(`code=${USER_PROMPT_SUBMIT_BLOCK_CODE}`);
    expect(USER_PROMPT_SUBMIT_BLOCK_CODE).toBe('user-prompt-submit-block');
  });

  it('defaults reason when empty', () => {
    const tip = formatUserPromptSubmitBlockTip();
    expect(tip).toContain('Blocked by UserPromptSubmit hook');
  });

  it('is idempotent when already prefixed', () => {
    const once = formatUserPromptSubmitBlockTip('x');
    expect(formatUserPromptSubmitBlockTip(once)).toBe(once);
  });
});
