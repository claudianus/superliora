import { describe, expect, it } from 'vitest';

import {
  WINGET_BUNDLE_URL,
  WINGET_RELEASE,
  ensureWinget,
  findWinget,
  skipWingetRequested,
  wellKnownWingetCandidates,
} from '../../../../scripts/install/ensure-winget.mjs';

describe('scripts/install/ensure-winget', () => {
  it('lists well-known winget.exe locations', () => {
    const list = wellKnownWingetCandidates({
      LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
      USERPROFILE: 'E:\\Users\\dev',
    });
    expect(list.some((p) => p.replaceAll('/', '\\').endsWith('\\WindowsApps\\winget.exe'))).toBe(true);
  });

  it('finds an existing winget on PATH', () => {
    const found = findWinget({
      platform: 'win32',
      env: {},
      which: (name: string) => (name === 'winget' ? 'D:\\Apps\\winget.exe' : undefined),
      isFile: (p: string) => p === 'D:\\Apps\\winget.exe',
    });
    expect(found?.source).toBe('path');
    expect(found?.alreadyPresent).toBe(true);
  });

  it('honors skip flags without downloading', async () => {
    let downloads = 0;
    expect(skipWingetRequested({ SUPERLIORA_NO_WINGET: '1' })).toBe(true);
    const skipped = await ensureWinget({
      skip: true,
      platform: 'win32',
      downloadToFile: async () => {
        downloads += 1;
        return '';
      },
    });
    expect(skipped.skipped).toBe(true);
    expect(downloads).toBe(0);
  });

  it('is a no-op on non-Windows', async () => {
    const result = await ensureWinget({ platform: 'linux' });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('pins a known winget release URL', () => {
    expect(WINGET_RELEASE).toBe('v1.29.280');
    expect(WINGET_BUNDLE_URL).toContain(WINGET_RELEASE);
    expect(WINGET_BUNDLE_URL).toContain('DesktopAppInstaller');
  });
});
