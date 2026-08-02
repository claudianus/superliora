import { describe, expect, it } from 'vitest';

import {
  SHELL_DEDICATED_BYPASS_CODE,
  extractShellDedicatedPreferTool,
  formatShellDedicatedBypassNotice,
  isShellDedicatedBypassOutput,
} from '../../../../src/tui/utils/tools/shell-dedicated-bypass-notice';

describe('isShellDedicatedBypassOutput', () => {
  it('detects the stable code marker', () => {
    expect(
      isShellDedicatedBypassOutput(
        `Bash blocked: this looks like a job for the Read tool (cat). Use Read. code=${SHELL_DEDICATED_BYPASS_CODE}`,
      ),
    ).toBe(true);
  });

  it('detects the legacy prose when code is missing', () => {
    expect(
      isShellDedicatedBypassOutput(
        'Bash blocked: this looks like a job for the Grep tool (rg). Prefer Grep.',
      ),
    ).toBe(true);
  });

  it('ignores ordinary Bash failures', () => {
    expect(isShellDedicatedBypassOutput('exit code 1')).toBe(false);
    expect(isShellDedicatedBypassOutput(null)).toBe(false);
  });
});

describe('extractShellDedicatedPreferTool', () => {
  it('parses the preferred tool name', () => {
    expect(
      extractShellDedicatedPreferTool(
        'Bash blocked: this looks like a job for the Write tool (redirect).',
      ),
    ).toBe('Write');
  });
});

describe('formatShellDedicatedBypassNotice', () => {
  it('names recovery path and coalesce key', () => {
    const notice = formatShellDedicatedBypassNotice(
      'Bash',
      `Bash blocked: this looks like a job for the Read tool (cat). code=${SHELL_DEDICATED_BYPASS_CODE}`,
    );
    expect(notice.title).toBe('Use dedicated tool');
    expect(notice.detail).toContain(SHELL_DEDICATED_BYPASS_CODE);
    expect(notice.detail).toContain('Read');
    expect(notice.status).toMatch(/use Read/);
    expect(notice.coalesceKey).toBe('shell-dedicated-bypass');
    expect(notice.prefer).toBe('Read');
  });
});
