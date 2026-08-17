import { deflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ImageThumbnail,
  resetKittyPlaceholderTransmissions,
} from '#/tui/components/media/image-thumbnail';
import { setKittyGraphicsChannel } from '#/tui/media/kitty-graphics-channel';
import type { ImageAttachment } from '#/tui/utils/image/image-attachment-store';
import {
  resetImageProtocolProbeForTests,
  setProbedKittyGraphicsForTests,
} from '#/tui/utils/image/image-protocol-detect';

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = deflateSync(scanlines);
  const parts = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function imageAttachment(bytes: Uint8Array): ImageAttachment {
  return {
    id: 42,
    kind: 'image',
    bytes,
    mime: 'image/png',
    width: 8,
    height: 8,
    placeholder: '[image #42 (8×8)]',
  };
}

function stubTruecolor(): void {
  vi.stubEnv('NO_COLOR', '');
  vi.stubEnv('CI', '');
  vi.stubEnv('FORCE_COLOR', '');
  vi.stubEnv('CLICOLOR_FORCE', '');
  vi.stubEnv('CLICOLOR', '');
  vi.stubEnv('TERM', 'xterm-256color');
  vi.stubEnv('TERM_PROGRAM', '');
  vi.stubEnv('KITTY_WINDOW_ID', '');
  vi.stubEnv('COLORTERM', 'truecolor');
  vi.stubEnv('TMUX', '');
  vi.stubEnv('ZELLIJ', '');
}

describe('ImageThumbnail protocol choice', () => {
  beforeEach(() => {
    resetKittyPlaceholderTransmissions();
    resetImageProtocolProbeForTests();
    setProbedKittyGraphicsForTests(null);
    setKittyGraphicsChannel(undefined);
  });

  afterEach(() => {
    setKittyGraphicsChannel(undefined);
    resetKittyPlaceholderTransmissions();
    resetImageProtocolProbeForTests();
    vi.unstubAllEnvs();
  });

  it('uses half-block raster when protocol is none (not a bare filename chip)', () => {
    stubTruecolor();
    vi.stubEnv('SUPERLIORA_IMAGE_PROTOCOL', 'none');
    const component = new ImageThumbnail(imageAttachment(makeSolidPng(8, 8, 255, 0, 0)));
    const lines = component.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes('▀'))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain('[image #42');
    }
  });

  it('emits iTerm2 OSC when SUPERLIORA_IMAGE_PROTOCOL=iterm2', () => {
    stubTruecolor();
    vi.stubEnv('SUPERLIORA_IMAGE_PROTOCOL', 'iterm2');
    const transmit = vi.fn();
    setKittyGraphicsChannel(transmit);
    const component = new ImageThumbnail(imageAttachment(makeSolidPng(8, 8, 0, 255, 0)));
    const lines = component.render(80);
    expect(transmit).toHaveBeenCalled();
    expect(String(transmit.mock.calls[0]![0])).toContain('1337');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('emits kitty placeholder transmit when protocol is kitty', () => {
    stubTruecolor();
    vi.stubEnv('SUPERLIORA_IMAGE_PROTOCOL', 'kitty');
    const transmit = vi.fn();
    setKittyGraphicsChannel(transmit);
    const component = new ImageThumbnail(imageAttachment(makeSolidPng(8, 8, 0, 0, 255)));
    const lines = component.render(80);
    expect(transmit).toHaveBeenCalled();
    expect(String(transmit.mock.calls[0]![0])).toContain('_G');
    expect(lines.some((line) => line.includes('\u{10EEEE}'))).toBe(true);
  });
});
