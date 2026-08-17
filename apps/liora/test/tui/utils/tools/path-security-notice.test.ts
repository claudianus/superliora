import { describe, expect, it } from 'vitest';

import {
  extractPathSecurityCode,
  formatPathSecurityNotice,
  isPathSecurityOutput,
} from '../../../../src/tui/utils/tools/path-security-notice';

describe('isPathSecurityOutput', () => {
  it('detects code markers', () => {
    expect(
      isPathSecurityOutput(
        '".env" matches a sensitive-file pattern (env / credential / SSH key). Access is blocked to protect secrets. code=PATH_SENSITIVE',
      ),
    ).toBe(true);
    expect(
      isPathSecurityOutput(
        '"/tmp/x" is outside the workspace. Sandbox profile denies read outside workspace roots. code=PATH_OUTSIDE_WORKSPACE',
      ),
    ).toBe(true);
  });

  it('detects legacy prose', () => {
    expect(isPathSecurityOutput('Sandbox is read-only: write/edit is blocked for "a.ts".')).toBe(
      true,
    );
  });

  it('ignores ordinary tool errors', () => {
    expect(isPathSecurityOutput('ENOENT: no such file')).toBe(false);
    expect(isPathSecurityOutput(null)).toBe(false);
  });
});

describe('extractPathSecurityCode', () => {
  it('returns the first matching PATH_* code', () => {
    expect(extractPathSecurityCode('fail code=PATH_READ_ONLY')).toBe('PATH_READ_ONLY');
  });
});

describe('formatPathSecurityNotice', () => {
  it('formats sensitive path recovery', () => {
    const notice = formatPathSecurityNotice('Read', 'blocked code=PATH_SENSITIVE');
    expect(notice.title).toBe('Sensitive path blocked');
    expect(notice.detail).toContain('PATH_SENSITIVE');
    expect(notice.coalesceKey).toBe('path-security');
    expect(notice.code).toBe('PATH_SENSITIVE');
  });

  it('formats outside workspace recovery', () => {
    const notice = formatPathSecurityNotice('Write', 'blocked code=PATH_OUTSIDE_WORKSPACE');
    expect(notice.title).toBe('Outside workspace');
    expect(notice.status).toMatch(/PATH_OUTSIDE_WORKSPACE/);
  });

  it('formats symlink escape recovery', () => {
    const notice = formatPathSecurityNotice('Read', 'blocked code=PATH_SYMLINK_OUTSIDE');
    expect(notice.title).toBe('Symlink leaves workspace');
    expect(notice.code).toBe('PATH_SYMLINK_OUTSIDE');
    expect(notice.status).toMatch(/PATH_SYMLINK_OUTSIDE/);
  });
});
