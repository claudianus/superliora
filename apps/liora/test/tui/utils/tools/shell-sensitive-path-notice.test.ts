import { describe, expect, it } from 'vitest';

import {
  SHELL_SENSITIVE_PATH_CODE,
  extractShellSensitivePath,
  formatShellSensitivePathNotice,
  isShellSensitivePathOutput,
} from '../../../../src/tui/utils/tools/shell-sensitive-path-notice';

describe('isShellSensitivePathOutput', () => {
  it('detects the stable code marker', () => {
    expect(
      isShellSensitivePathOutput(
        `Bash blocked: sensitive path. ".env" matches a sensitive-file pattern. code=${SHELL_SENSITIVE_PATH_CODE}`,
      ),
    ).toBe(true);
  });

  it('detects legacy prose without code', () => {
    expect(isShellSensitivePathOutput('Bash blocked: sensitive path. denied.')).toBe(true);
  });

  it('ignores ordinary failures', () => {
    expect(isShellSensitivePathOutput('exit 1')).toBe(false);
    expect(isShellSensitivePathOutput(null)).toBe(false);
  });
});

describe('extractShellSensitivePath', () => {
  it('parses the quoted path', () => {
    expect(
      extractShellSensitivePath(
        'Bash blocked: sensitive path. ".ssh/id_rsa" matches a sensitive-file pattern.',
      ),
    ).toBe('.ssh/id_rsa');
  });
});

describe('formatShellSensitivePathNotice', () => {
  it('names path and recovery limits', () => {
    const notice = formatShellSensitivePathNotice(
      'Bash',
      `Bash blocked: sensitive path. ".env" matches a sensitive-file pattern. code=${SHELL_SENSITIVE_PATH_CODE}`,
    );
    expect(notice.title).toBe('Sensitive path blocked');
    expect(notice.detail).toContain(SHELL_SENSITIVE_PATH_CODE);
    expect(notice.detail).toContain('.env');
    expect(notice.status).toMatch(/\.env/);
    expect(notice.coalesceKey).toBe('shell-sensitive-path');
    expect(notice.path).toBe('.env');
  });
});
