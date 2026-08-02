import { describe, expect, it } from 'vitest';

import {
  CIRCUIT_BREAKER_OPEN_CODE,
  CIRCUIT_BREAKER_RECOVERED_CODE,
  formatCircuitBreakerOpenNotice,
  formatCircuitBreakerRecoveredNotice,
  isCircuitBreakerOpenOutput,
  isCircuitBreakerRecoveredOutput,
} from '../../../../src/tui/utils/tools/circuit-breaker-notice';

describe('isCircuitBreakerOpenOutput', () => {
  it('detects the stable marker', () => {
    expect(
      isCircuitBreakerOpenOutput(
        `${CIRCUIT_BREAKER_OPEN_CODE}: Tool "Bash" is temporarily unavailable`,
      ),
    ).toBe(true);
  });

  it('detects legacy copy for back-compat', () => {
    expect(
      isCircuitBreakerOpenOutput(
        'Tool "Read" is temporarily unavailable due to repeated failures. Circuit breaker open — will retry after cooldown.',
      ),
    ).toBe(true);
  });

  it('ignores ordinary failures', () => {
    expect(isCircuitBreakerOpenOutput('ENOENT')).toBe(false);
    expect(isCircuitBreakerOpenOutput(null)).toBe(false);
  });
});

describe('formatCircuitBreakerOpenNotice', () => {
  it('names the tool and recovery path', () => {
    const notice = formatCircuitBreakerOpenNotice('Bash');
    expect(notice.title).toBe('Circuit breaker open');
    expect(notice.detail).toContain('Bash');
    expect(notice.detail).toContain(CIRCUIT_BREAKER_OPEN_CODE);
    expect(notice.status).toMatch(/circuit breaker open on Bash/);
    expect(notice.coalesceKey).toBe('circuit-breaker-open');
  });
});

describe('isCircuitBreakerRecoveredOutput (Loop29a)', () => {
  it('detects the recovery marker', () => {
    expect(
      isCircuitBreakerRecoveredOutput(
        `${CIRCUIT_BREAKER_RECOVERED_CODE}: Tool "Bash" probe succeeded (from half-open)`,
      ),
    ).toBe(true);
  });

  it('ignores open-only and ordinary results', () => {
    expect(isCircuitBreakerRecoveredOutput(`${CIRCUIT_BREAKER_OPEN_CODE}: blocked`)).toBe(false);
    expect(isCircuitBreakerRecoveredOutput('ok')).toBe(false);
    expect(isCircuitBreakerRecoveredOutput(null)).toBe(false);
  });
});

describe('formatCircuitBreakerRecoveredNotice (Loop29a)', () => {
  it('names the tool and closed state', () => {
    const notice = formatCircuitBreakerRecoveredNotice('Bash');
    expect(notice.title).toBe('Circuit breaker recovered');
    expect(notice.detail).toContain('Bash');
    expect(notice.detail).toContain(CIRCUIT_BREAKER_RECOVERED_CODE);
    expect(notice.status).toMatch(/circuit closed on Bash/);
    expect(notice.coalesceKey).toBe('circuit-breaker-recovered');
  });
});
