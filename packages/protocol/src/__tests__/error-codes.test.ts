import { describe, expect, it } from 'vitest';

import { ErrorCode, ErrorCodeReason } from '../error-codes';

describe('protocol/error-codes — ErrorCode / ErrorCodeReason', () => {
  it('reports SUCCESS as 0 and uses integer values throughout', () => {
    expect(ErrorCode.SUCCESS).toBe(0);
    for (const [, value] of Object.entries(ErrorCode)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('uses integer client/daemon/tool namespaces (4xxxx client, 5xxxx daemon, 6xxxx tool)', () => {
    const namespaces = new Set<number>();
    for (const [, value] of Object.entries(ErrorCode)) {
      if (value === 0) continue;
      namespaces.add(Math.floor(value / 10000));
    }
    // Today the protocol registers 4 / 5 / 6; 7 (provider passthrough) and
    // 8 (MCP passthrough) are reserved for future use. Assert the lower
    // three are populated and any present value is a multi-digit code.
    expect([...namespaces].toSorted()).toEqual([4, 5, 6]);
  });

  it('assigns every ErrorCode entry a non-empty reason string', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      const reason = ErrorCodeReason[value as keyof typeof ErrorCodeReason];
      expect(typeof reason, `reason missing for ${key} (${value})`).toBe('string');
      expect((reason).length, `reason empty for ${key} (${value})`).toBeGreaterThan(0);
    }
  });

  it('keeps the ErrorCode / ErrorCodeReason shapes aligned (1:1 by code value)', () => {
    const codeValues = new Set(Object.values(ErrorCode));
    const reasonKeys = new Set(Object.keys(ErrorCodeReason).map(Number));
    expect(codeValues).toEqual(reasonKeys);
  });
});
