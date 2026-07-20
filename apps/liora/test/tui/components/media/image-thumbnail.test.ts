import { deflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ImageThumbnail,
  resetKittyPlaceholderTransmissions,
} from '#/tui/components/media/image-thumbnail';
import { setKittyGraphicsChannel } from '#/tui/media/kitty-graphics-channel';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';

const SGR_RE = /\u001B\[[0-9;]*m/g;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffff_ffff;
  for (let i = start; i < end; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return Math.trunc(crc ^ 0xffff_ffff);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.codePointAt(i)!;
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Build a real solid-color RGBA PNG (filter 0, single IDAT). */
function makeSolidPng(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const stride = 1 + width * 4;
  const scanlines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    scanlines[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 4;
      scanlines[p] = r;
      scanlines[p + 1] = g;
      scanlines[p + 2] = b;
      scanlines[p + 3] = 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA

  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(scanlines);
  const total =
    signature.length + (12 + ihdr.length) + (12 + idat.length) + 12;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function imageAttachment(
  bytes: Uint8Array,
  mime: string,
  width: number,
  height: number,
): ImageAttachment {
  return {
    id: 1,
    kind: 'image',
    bytes,
    mime,
    width,
    height,
    placeholder: `[image #1 (${width}×${height})]`,
  };
}

function stubColorEnv(mode: 'truecolor' | '256'): void {
  vi.stubEnv('NO_COLOR', '');
  vi.stubEnv('CI', '');
  vi.stubEnv('FORCE_COLOR', '');
  vi.stubEnv('CLICOLOR_FORCE', '');
  vi.stubEnv('CLICOLOR', '');
  vi.stubEnv('TERM', 'xterm-256color');
  vi.stubEnv('TERM_PROGRAM', '');
  vi.stubEnv('KITTY_WINDOW_ID', '');
  vi.stubEnv('COLORTERM', mode === 'truecolor' ? 'truecolor' : '');
}

function stubKittyEnv(): void {
  stubColorEnv('truecolor');
  vi.stubEnv('TERM', 'xterm-kitty');
  vi.stubEnv('KITTY_WINDOW_ID', '1');
  vi.stubEnv('TMUX', '');
  vi.stubEnv('ZELLIJ', '');
}

function stripSgr(line: string): string {
  return line.replaceAll(SGR_RE, '');
}

describe('ImageThumbnail', () => {
  afterEach(() => {
    setKittyGraphicsChannel(undefined);
    resetKittyPlaceholderTransmissions();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders PNG attachments as half-block previews', () => {
    stubColorEnv('256');
    const component = new ImageThumbnail(
      imageAttachment(makeSolidPng(8, 8, 255, 0, 0), 'image/png', 8, 8),
    );

    const lines = component.render(80);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain('▀');
    }
  });

  it('emits truecolor SGR when COLORTERM=truecolor', () => {
    stubColorEnv('truecolor');
    const component = new ImageThumbnail(
      imageAttachment(makeSolidPng(8, 8, 255, 0, 0), 'image/png', 8, 8),
    );

    const lines = component.render(80);

    expect(lines.some((line) => line.includes('38;2;'))).toBe(true);
    expect(lines.some((line) => line.includes('48;2;'))).toBe(true);
  });

  it('caps a 1000×1000 PNG at 12 lines of at most 32 cells on compact widths', () => {
    stubColorEnv('truecolor');
    const component = new ImageThumbnail(
      imageAttachment(makeSolidPng(1000, 1000, 0, 255, 0), 'image/png', 1000, 1000),
    );

    const lines = component.render(80);

    expect(lines.length).toBeLessThanOrEqual(12);
    for (const line of lines) {
      expect(stripSgr(line).length).toBeLessThanOrEqual(32);
    }
  });

  it('widens the preview cap on wide layouts', () => {
    stubColorEnv('truecolor');
    const component = new ImageThumbnail(
      imageAttachment(makeSolidPng(1000, 250, 0, 0, 255), 'image/png', 1000, 250),
    );

    const lines = component.render(140);

    const widest = Math.max(...lines.map((line) => stripSgr(line).length));
    expect(widest).toBeGreaterThan(40);
    expect(widest).toBeLessThanOrEqual(56);
  });

  it('keeps previews within narrow widths', () => {
    stubColorEnv('256');
    const component = new ImageThumbnail(
      imageAttachment(makeSolidPng(8, 8, 0, 0, 255), 'image/png', 8, 8),
    );

    for (const width of [39, 20, 10, 1]) {
      for (const line of component.render(width)) {
        expect(stripSgr(line).length).toBeLessThanOrEqual(width);
      }
    }
  });

  it('caches built lines for repeated same-width renders', () => {
    stubColorEnv('256');
    const component = new ImageThumbnail(
      imageAttachment(makeSolidPng(8, 8, 1, 2, 3), 'image/png', 8, 8),
    );

    expect(component.render(80)).toBe(component.render(80));
  });

  it('falls back to the placeholder marker for image/jpeg', () => {
    const component = new ImageThumbnail(
      imageAttachment(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg', 8, 8),
    );

    const lines = component.render(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[image #1 (8×8)]');
  });

  it('falls back to the placeholder marker for corrupt PNG bytes', () => {
    const component = new ImageThumbnail(
      imageAttachment(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), 'image/png', 8, 8),
    );

    const lines = component.render(80);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[image #1 (8×8)]');
  });

  describe('kitty unicode placeholder protocol', () => {
    beforeEach(() => {
      resetKittyPlaceholderTransmissions();
    });

    it('renders placeholder text and transmits the image once', () => {
      stubKittyEnv();
      const transmit = vi.fn();
      setKittyGraphicsChannel(transmit);
      const component = new ImageThumbnail(
        imageAttachment(makeSolidPng(8, 8, 255, 0, 0), 'image/png', 8, 8),
      );

      const lines = component.render(80);

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain('\u{10EEEE}');
        expect(line).not.toContain('▀');
      }
      expect(transmit).toHaveBeenCalledTimes(1);
      expect(transmit.mock.calls[0]![0]).toContain('a=T,U=1');
      expect(transmit.mock.calls[0]![0]).toContain('q=2');

      component.render(80);
      expect(transmit).toHaveBeenCalledTimes(1);
    });

    it('does not re-transmit when a second component renders the same attachment', () => {
      stubKittyEnv();
      const transmit = vi.fn();
      setKittyGraphicsChannel(transmit);
      const attachment = imageAttachment(makeSolidPng(8, 8, 0, 255, 0), 'image/png', 8, 8);

      new ImageThumbnail(attachment).render(80);
      new ImageThumbnail(attachment).render(80);

      expect(transmit).toHaveBeenCalledTimes(1);
    });

    it('falls back to half-block rendering without a graphics channel', () => {
      stubKittyEnv();
      setKittyGraphicsChannel(undefined);
      const component = new ImageThumbnail(
        imageAttachment(makeSolidPng(8, 8, 0, 0, 255), 'image/png', 8, 8),
      );

      const lines = component.render(80);

      expect(lines.some((line) => line.includes('▀'))).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain('\u{10EEEE}');
      }
    });
  });
});
