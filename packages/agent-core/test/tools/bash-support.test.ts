import { describe, expect, it } from 'vitest';

import {
  isValidTimeoutValue,
  normalizeTimeoutMs,
  rewriteWindowsNullRedirect,
  shellQuote,
} from '#/tools/builtin/shell/bash-support';

describe('bash-support', () => {
  it('normalizes foreground timeout with cap', () => {
    expect(normalizeTimeoutMs(120, false)).toBe(120_000);
    expect(normalizeTimeoutMs(9_999, false)).toBe(300_000);
  });

  it('validates timeout bounds', () => {
    expect(isValidTimeoutValue(60, false)).toBe(true);
    expect(isValidTimeoutValue(301, false)).toBe(false);
  });

  it('quotes shell paths safely', () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });

  it('rewrites Windows NUL redirects', () => {
    expect(rewriteWindowsNullRedirect('echo hi > nul')).toBe('echo hi > /dev/null');
  });
});
