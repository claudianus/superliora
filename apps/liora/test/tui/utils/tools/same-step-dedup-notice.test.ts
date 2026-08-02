import { describe, expect, it } from 'vitest';

import {
  SAME_STEP_DEDUP_PREFIX,
  formatSameStepDedupNotice,
  isSameStepDedupOutput,
} from '../../../../src/tui/utils/tools/same-step-dedup-notice';

describe('isSameStepDedupOutput', () => {
  it('detects the stable marker', () => {
    expect(
      isSameStepDedupOutput(
        `FILE_A\n\n${SAME_STEP_DEDUP_PREFIX} identical Read args already executed in this step`,
      ),
    ).toBe(true);
  });

  it('ignores ordinary successes', () => {
    expect(isSameStepDedupOutput('FILE_A')).toBe(false);
    expect(isSameStepDedupOutput(null)).toBe(false);
  });
});

describe('formatSameStepDedupNotice', () => {
  it('names the tool and recovery path', () => {
    const notice = formatSameStepDedupNotice('Read');
    expect(notice.title).toBe('Same-step tool dedup');
    expect(notice.detail).toContain('Read');
    expect(notice.detail).toContain(SAME_STEP_DEDUP_PREFIX);
    expect(notice.status).toMatch(/Same-step dedup on Read/);
    expect(notice.coalesceKey).toBe('same-step-dedup');
  });

  it('falls back when tool name is missing', () => {
    const notice = formatSameStepDedupNotice();
    expect(notice.status).toMatch(/on tool/);
  });
});
