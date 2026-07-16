import { describe, expect, it } from 'vitest';

import { StreamingThinkScrubber, stripThinkBlocks } from '../../src/utils/think-scrubber';

describe('StreamingThinkScrubber', () => {
  it('strips complete think blocks from a finished string', () => {
    expect(stripThinkBlocks('hello <think>secret</think> world')).toBe('hello  world');
  });

  it('handles streamed open/content/close deltas without leaking reasoning', () => {
    const scrubber = new StreamingThinkScrubber();
    expect(scrubber.feed('<think>')).toBe('');
    expect(scrubber.feed('Let me inspect config')).toBe('');
    expect(scrubber.feed('</think>')).toBe('');
    expect(scrubber.feed('Visible answer')).toBe('Visible answer');
    expect(scrubber.flush()).toBe('');
  });

  it('does not suppress prose that mentions think tags mid-line', () => {
    const scrubber = new StreamingThinkScrubber();
    const out = scrubber.feed('Please use <think> tags carefully.');
    expect(out + scrubber.flush()).toContain('use <think> tags carefully');
  });

  it('suppresses reasoning_scratchpad blocks case-insensitively', () => {
    expect(stripThinkBlocks('<REASONING_SCRATCHPAD>x</REASONING_SCRATCHPAD>ok')).toBe('ok');
  });
});
