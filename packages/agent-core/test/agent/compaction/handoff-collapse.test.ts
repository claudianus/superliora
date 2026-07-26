import { describe, expect, it } from 'vitest';

import {
  SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS,
  SWARM_EXPERT_BODY_MAX_CHARS,
  collapseForHandoff,
} from '../../../src/agent/compaction/handoff-collapse';

describe('handoff-collapse.ts — collapseForHandoff', () => {
  it('returns the text unchanged when below the default cap', () => {
    const out = collapseForHandoff('hello world');
    expect(out).toBe('hello world');
  });

  it('trims and collapses internal whitespace runs', () => {
    const out = collapseForHandoff('  hello\n\n   world\t\t!  ');
    expect(out).toBe('hello world !');
  });

  it('does not touch text equal to the cap', () => {
    const exact = 'x'.repeat(SWARM_EXPERT_BODY_MAX_CHARS);
    expect(collapseForHandoff(exact)).toBe(exact);
  });

  it('truncates with an ellipsis once over the cap (default)', () => {
    const long = 'a'.repeat(SWARM_EXPERT_BODY_MAX_CHARS + 50);
    const out = collapseForHandoff(long);
    expect(out.length).toBe(SWARM_EXPERT_BODY_MAX_CHARS);
    expect(out.endsWith('...')).toBe(true);
  });

  it('honors a custom maxChars argument', () => {
    const long = 'b'.repeat(200);
    const out = collapseForHandoff(long, 50);
    expect(out).toBe('b'.repeat(47) + '...');
  });

  it('counts collapsed length against maxChars (whitespace runs collapse first)', () => {
    // 'a\n\nb\n\nc' collapses to 'a b c' (5 chars). The threshold is
    // inclusive — at the cap the text is returned verbatim, only over the
    // cap does the slice + '...' kick in. slice(0, maxChars-3) leaves room
    // for the literal '...'.
    const padded = 'a\n\nb\n\nc';
    expect(collapseForHandoff(padded, 7)).toBe('a b c');
    expect(collapseForHandoff(padded, 5)).toBe('a b c');
    // maxChars=4 → keep first 1 char, append '...' → 'a...'
    expect(collapseForHandoff(padded, 4)).toBe('a...');
  });

  it('pins SWARM_EXPERT_BODY_MAX_CHARS to the documented 1_600 default', () => {
    expect(SWARM_EXPERT_BODY_MAX_CHARS).toBe(1_600);
    expect(SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS).toBe(120);
    // The inline summary must stay well below the expert body cap so a
    // single handoff does not bloat context with embedded bodies.
    expect(SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS).toBeLessThan(SWARM_EXPERT_BODY_MAX_CHARS);
  });
});
