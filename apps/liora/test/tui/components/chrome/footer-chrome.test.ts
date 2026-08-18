import { afterEach, describe, expect, it } from 'vitest';

import {
  footerNextAction,
  shortenCwd,
} from '#/tui/components/chrome/footer/footer-chrome';
import { ttui } from '#/tui/utils/tui-i18n';
import type { AppState } from '#/tui/types';

const previousHome = process.env['HOME'];
const previousProfile = process.env['USERPROFILE'];

afterEach(() => {
  if (previousHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = previousHome;
  if (previousProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = previousProfile;
});

describe('shortenCwd', () => {
  it('shortens POSIX HOME paths', () => {
    process.env['HOME'] = '/home/ada';
    delete process.env['USERPROFILE'];
    expect(shortenCwd('/home/ada')).toBe('~');
    expect(shortenCwd('/home/ada/code/superliora')).toBe('~/code/superliora');
    expect(shortenCwd('/home/ada/Desktop/code/superliora')).toBe('…/Desktop/code/superliora');
  });

  it('shortens Windows USERPROFILE paths with backslashes', () => {
    delete process.env['HOME'];
    process.env['USERPROFILE'] = 'C:\\Users\\Ada';
    expect(shortenCwd('C:\\Users\\Ada')).toBe('~');
    expect(shortenCwd('C:\\Users\\Ada\\Desktop\\code\\superliora')).toBe(
      '…/Desktop/code/superliora',
    );
  });
});

describe('footerNextAction', () => {
  const base = {
    model: 'kimi-k2',
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    contextUsage: 0,
    premiumQualityMode: false,
  } as AppState;

  it('uses replaying copy only when history is actually replaying', () => {
    expect(footerNextAction({ ...base, isReplaying: true }, null)).toBe(
      ttui('tui.footer.replaying'),
    );
    expect(footerNextAction(base, null)).not.toBe(ttui('tui.footer.replaying'));
  });
});
