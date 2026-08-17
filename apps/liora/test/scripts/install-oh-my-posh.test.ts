import { describe, expect, it } from 'vitest';

import {
  OMP_EXE_URL,
  OMP_WINGET_ID,
  ensureOhMyPosh,
  findOhMyPosh,
  ohMyPoshDownloadUrl,
  renderNeonNoirOmpTheme,
  skipOhMyPoshRequested,
  wellKnownOhMyPoshCandidates,
} from '../../../../scripts/install/ensure-oh-my-posh.mjs';

describe('scripts/install/ensure-oh-my-posh', () => {
  it('lists user-local Oh My Posh paths', () => {
    const list = wellKnownOhMyPoshCandidates({
      LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
      USERPROFILE: 'E:\\Users\\dev',
    });
    expect(list.some((p) => p.replaceAll('/', '\\').includes('\\oh-my-posh.exe'))).toBe(true);
    expect(list.some((p) => p.replaceAll('/', '\\').includes('\\runtime\\oh-my-posh\\'))).toBe(true);
  });

  it('finds an already-installed Oh My Posh', () => {
    const exe = 'E:\\Users\\dev\\.superliora\\runtime\\oh-my-posh\\oh-my-posh.exe';
    const found = findOhMyPosh({
      platform: 'win32',
      env: { USERPROFILE: 'E:\\Users\\dev', HOME: 'E:\\Users\\dev' },
      isFile: (p: string) => p === exe,
      which: () => undefined,
    });
    expect(found?.alreadyPresent).toBe(true);
    expect(found?.ompPath).toBe(exe);
  });

  it('writes the Neon Noir theme even when skipPackages is set', async () => {
    const files = new Map<string, string>();
    const result = await ensureOhMyPosh({
      platform: 'win32',
      skipPackages: true,
      env: { USERPROFILE: 'E:\\Users\\dev' },
      isFile: () => false,
      which: () => undefined,
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
    });
    expect(result.themeWritten).toBe(true);
    expect(result.ok).toBe(true);
    const theme = JSON.parse([...files.values()][0] ?? '{}');
    expect(theme.palette.primary).toBe('#00D5FF');
    expect(theme.palette.accent).toBe('#A78BFA');
  });

  it('honors skip flags', async () => {
    expect(skipOhMyPoshRequested({ SUPERLIORA_NO_POSH: '1' })).toBe(true);
    const skipped = await ensureOhMyPosh({ skip: true, platform: 'win32' });
    expect(skipped.skipped).toBe(true);
  });

  it('skips unsupported platforms and skipPackages downloads', async () => {
    const unsupported = await ensureOhMyPosh({ platform: 'aix' });
    expect(unsupported.skipped).toBe(true);
    expect(unsupported.ok).toBe(true);

    const files = new Map<string, string>();
    const darwin = await ensureOhMyPosh({
      platform: 'darwin',
      skipPackages: true,
      env: { HOME: '/Users/dev' },
      isFile: () => false,
      which: () => undefined,
      writeFile: async (dest: string, text: string) => {
        files.set(dest, text);
      },
    });
    expect(darwin.ok).toBe(true);
    expect(darwin.themeWritten).toBe(true);
    expect(files.size).toBe(1);
    expect(ohMyPoshDownloadUrl('darwin', 'arm64')).toContain('posh-darwin-arm64');
    expect(ohMyPoshDownloadUrl('linux', 'x64')).toContain('posh-linux-amd64');
  });

  it('pins the winget id and ships a Neon Noir prompt', () => {
    expect(OMP_WINGET_ID).toBe('JanDeDobbeleer.OhMyPosh');
    expect(OMP_EXE_URL).toContain('posh-windows-amd64.exe');
    const theme = renderNeonNoirOmpTheme();
    expect(theme.palette.primary).toBe('#00D5FF');
    expect(theme.blocks[1]?.newline).toBe(true);
  });
});
