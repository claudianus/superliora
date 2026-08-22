import { describe, expect, it } from 'vitest';

import {
  BRAND_ICON_FILE,
  BRAND_ICON_PNG_FILE,
  brandIconPath,
  brandPngPath,
  ensureBrandIcon,
  materializeBrandShortcutIcon,
} from '../../../../scripts/install/brand-icon.mjs';

function icoMagic(bytes: Buffer): boolean {
  return bytes.length > 6
    && bytes[0] === 0
    && bytes[1] === 0
    && bytes[2] === 1
    && bytes[3] === 0
    && (bytes[4] ?? 0) >= 1;
}

function pngMagic(bytes: Buffer): boolean {
  return bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47;
}

describe('scripts/install/brand-icon', () => {
  it('writes a PNG-in-ICO Windows icon and a 256px PNG', async () => {
    const files = new Map<string, Buffer>();
    const dest = await ensureBrandIcon({
      platform: 'win32',
      binDir: 'C:\\Apps\\SuperLiora\\bin',
      writeFile: async (path: string, bytes: Buffer) => {
        files.set(path.replaceAll('/', '\\'), Buffer.from(bytes));
      },
    });
    expect(dest.replaceAll('/', '\\')).toBe(`C:\\Apps\\SuperLiora\\bin\\${BRAND_ICON_FILE}`);
    const ico = files.get(`C:\\Apps\\SuperLiora\\bin\\${BRAND_ICON_FILE}`);
    const png = files.get(`C:\\Apps\\SuperLiora\\bin\\${BRAND_ICON_PNG_FILE}`);
    expect(ico && icoMagic(ico)).toBe(true);
    expect(png && pngMagic(png)).toBe(true);
    expect(ico!.length).toBeGreaterThan(1024);
  });

  it('materializes an .ico on Windows and a PNG on POSIX', async () => {
    const win = await materializeBrandShortcutIcon({
      platform: 'win32',
      binDir: 'C:\\Apps\\SuperLiora\\bin',
      writeFile: async () => {},
    });
    expect(win?.replaceAll('/', '\\')).toBe(brandIconPath({
      platform: 'win32',
      binDir: 'C:\\Apps\\SuperLiora\\bin',
    }).replaceAll('/', '\\'));

    const linux = await materializeBrandShortcutIcon({
      platform: 'linux',
      binDir: '/home/dev/.local/bin',
      writeFile: async () => {},
    });
    expect(linux).toBe(brandPngPath({
      platform: 'linux',
      binDir: '/home/dev/.local/bin',
    }));
  });
});
