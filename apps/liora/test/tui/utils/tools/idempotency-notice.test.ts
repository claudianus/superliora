import { describe, expect, it } from 'vitest';

import {
  IDEMPOTENCY_REPLAY_CODE,
  formatIdempotencyReplayNotice,
  isIdempotencyReplayOutput,
} from '../../../../src/tui/utils/tools/idempotency-notice';

describe('isIdempotencyReplayOutput', () => {
  it('detects the stable marker', () => {
    expect(
      isIdempotencyReplayOutput(
        `wrote a.ts\n\n${IDEMPOTENCY_REPLAY_CODE}: identical Write args already applied`,
      ),
    ).toBe(true);
  });

  it('ignores ordinary successes', () => {
    expect(isIdempotencyReplayOutput('wrote a.ts')).toBe(false);
    expect(isIdempotencyReplayOutput(null)).toBe(false);
  });
});

describe('formatIdempotencyReplayNotice', () => {
  it('names the tool and recovery path', () => {
    const notice = formatIdempotencyReplayNotice('Write');
    expect(notice.title).toBe('Idempotent write replayed');
    expect(notice.detail).toContain('Write');
    expect(notice.detail).toContain(IDEMPOTENCY_REPLAY_CODE);
    expect(notice.status).toMatch(/Idempotent replay on Write/);
    expect(notice.coalesceKey).toBe('idempotency-replay');
  });
});
