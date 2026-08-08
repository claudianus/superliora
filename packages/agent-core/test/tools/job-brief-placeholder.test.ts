import { describe, expect, it } from 'vitest';

import {
  findPlaceholderBriefLine,
  isPlaceholderBriefLine,
} from '../../src/tools/builtin/job/job-brief';

describe('job brief placeholder lines', () => {
  it('flags TBD/TODO/later stall phrases', () => {
    expect(isPlaceholderBriefLine('TBD')).toBe(true);
    expect(isPlaceholderBriefLine('todo')).toBe(true);
    expect(isPlaceholderBriefLine('later')).toBe(true);
    expect(isPlaceholderBriefLine('to be determined')).toBe(true);
    expect(isPlaceholderBriefLine('fill in later')).toBe(true);
    expect(isPlaceholderBriefLine('coming soon')).toBe(true);
    expect(isPlaceholderBriefLine('success criteria TBD')).toBe(true);
    expect(isPlaceholderBriefLine('...')).toBe(true);
  });

  it('allows concrete verifiable lines', () => {
    expect(isPlaceholderBriefLine('auth refresh race test passes')).toBe(false);
    expect(isPlaceholderBriefLine('pnpm -C apps/liora run smoke exits 0')).toBe(false);
    expect(isPlaceholderBriefLine('footer shows job strip when ≥1 job is running')).toBe(false);
    expect(isPlaceholderBriefLine('')).toBe(false);
  });

  it('returns the first placeholder in a list', () => {
    expect(findPlaceholderBriefLine(['real check passes', 'TBD'])).toBe('TBD');
    expect(findPlaceholderBriefLine(['real check passes'])).toBeUndefined();
  });
});
