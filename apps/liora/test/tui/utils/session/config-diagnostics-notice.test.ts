import { describe, expect, it } from 'vitest';

import {
  formatConfigDiagnosticsNotice,
  isConfigKeptPreviousWarning,
} from '../../../../src/tui/utils/session/config-diagnostics-notice';

describe('isConfigKeptPreviousWarning', () => {
  it('detects the kept-previous marker', () => {
    expect(
      isConfigKeptPreviousWarning(
        'config.toml has errors; keeping the previously loaded configuration.',
      ),
    ).toBe(true);
    expect(isConfigKeptPreviousWarning('unknown key experimental.foo')).toBe(false);
  });
});

describe('formatConfigDiagnosticsNotice', () => {
  it('returns undefined for empty warnings', () => {
    expect(formatConfigDiagnosticsNotice([])).toBeUndefined();
  });

  it('formats soft env/file warnings', () => {
    const notice = formatConfigDiagnosticsNotice(['unknown key experimental.foo']);
    expect(notice).toBeDefined();
    expect(notice!.title).toBe('Config diagnostics');
    expect(notice!.detail).toContain('unknown key experimental.foo');
    expect(notice!.status).toMatch(/Config diagnostics \(1\)/);
    expect(notice!.coalesceKey).toBe('config-diagnostics');
    expect(notice!.keptPrevious).toBe(false);
  });

  it('formats hard keep-previous reload degradation', () => {
    const notice = formatConfigDiagnosticsNotice([
      'parse error at line 3',
      'config.toml has errors; keeping the previously loaded configuration.',
    ]);
    expect(notice).toBeDefined();
    expect(notice!.title).toBe('Config reload degraded');
    expect(notice!.detail).toContain('previous configuration was kept');
    expect(notice!.status).toMatch(/kept previous config/);
    expect(notice!.keptPrevious).toBe(true);
  });
});
