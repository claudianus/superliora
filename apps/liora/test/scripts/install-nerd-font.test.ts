import { describe, expect, it } from 'vitest';

import {
  CASKAYDIA_FONT_FACE,
  CASKAYDIA_FONT_ZIP_URL,
  CASKAYDIA_WINGET_ID,
  ensureNerdFont,
  findNerdFont,
  skipNerdFontRequested,
  wellKnownNerdFontFiles,
} from '../../../../scripts/install/ensure-nerd-font.mjs';

describe('scripts/install/ensure-nerd-font', () => {
  it('lists user and system CaskaydiaCove files', () => {
    const list = wellKnownNerdFontFiles({
      LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local',
      USERPROFILE: 'E:\\Users\\dev',
    });
    expect(list.some((p) => p.includes('CaskaydiaCoveNerdFont-Regular.ttf'))).toBe(true);
    expect(list.some((p) => p.replaceAll('/', '\\').includes('\\Microsoft\\Windows\\Fonts\\'))).toBe(true);
  });

  it('finds an already-installed Nerd Font file', () => {
    const font = 'E:\\Users\\dev\\AppData\\Local\\Microsoft\\Windows\\Fonts\\CaskaydiaCoveNerdFont-Regular.ttf';
    const found = findNerdFont({
      platform: 'win32',
      env: { LOCALAPPDATA: 'E:\\Users\\dev\\AppData\\Local', USERPROFILE: 'E:\\Users\\dev' },
      isFile: (p: string) => p === font,
    });
    expect(found?.face).toBe(CASKAYDIA_FONT_FACE);
    expect(found?.alreadyPresent).toBe(true);
  });

  it('honors skip flags without downloading', async () => {
    let downloads = 0;
    expect(skipNerdFontRequested({ SUPERLIORA_NO_NERD_FONT: '1' })).toBe(true);
    const skipped = await ensureNerdFont({
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
    const result = await ensureNerdFont({ platform: 'darwin' });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('pins the CaskaydiaCove winget id and zip', () => {
    expect(CASKAYDIA_WINGET_ID).toBe('ryanoasis.CaskaydiaCove');
    expect(CASKAYDIA_FONT_ZIP_URL).toContain('CascadiaCode.zip');
  });
});
