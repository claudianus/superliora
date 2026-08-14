import { afterEach, describe, expect, it } from 'vitest';

import { CTRL_C_HINT, CTRL_D_HINT } from '#/tui/constant/liora-tui';
import { formatPrimaryChord, primaryChord } from '#/tui/utils/os-shortcuts';
import { ttui } from '#/tui/utils/tui-i18n';

const originalPlatform = process.platform;

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  stubPlatform(originalPlatform);
});

describe('formatPrimaryChord / primaryChord OS hint SSOT', () => {
  it.each([
    ['darwin', 'Cmd-R'],
    ['linux', 'Ctrl-R'],
    ['win32', 'Ctrl-R'],
  ] as const)('labels history search as %s → %s', (platform, expected) => {
    expect(formatPrimaryChord('R', platform)).toBe(expected);
    stubPlatform(platform);
    expect(primaryChord('R')).toBe(expected);
  });

  it('uses Cmd on darwin and Ctrl elsewhere for footer exit hints', () => {
    stubPlatform('darwin');
    expect(CTRL_C_HINT()).toBe('Press Cmd-C again to exit');
    expect(CTRL_D_HINT()).toBe('Press Cmd-D again to exit');

    stubPlatform('linux');
    expect(CTRL_C_HINT()).toBe('Press Ctrl-C again to exit');
    expect(CTRL_D_HINT()).toBe('Press Ctrl-D again to exit');

    stubPlatform('win32');
    expect(CTRL_C_HINT()).toBe('Press Ctrl-C again to exit');
    expect(CTRL_D_HINT()).toBe('Press Ctrl-D again to exit');
  });

  it('keeps i18n tip/toast templates on the same chord as the matcher', () => {
    stubPlatform('darwin');
    expect(ttui('tui.tip.ctrlK', { chord: primaryChord('K') })).toContain('Cmd-K');
    expect(ttui('tui.history.searchToast', { chord: primaryChord('R') })).toContain('Cmd-R');
    expect(ttui('tui.history.searchToast', { chord: primaryChord('R') })).not.toContain('Ctrl-R');

    stubPlatform('linux');
    expect(ttui('tui.tip.ctrlK', { chord: primaryChord('K') })).toContain('Ctrl-K');
    expect(ttui('tui.history.searchToast', { chord: primaryChord('R') })).toContain('Ctrl-R');
    expect(ttui('tui.history.searchToast', { chord: primaryChord('R') })).not.toContain('Cmd-R');
  });
});
