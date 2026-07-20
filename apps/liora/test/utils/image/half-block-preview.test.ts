import { describe, expect, it } from 'vitest';

import { renderHalfBlockPreview } from '#/utils/image/half-block-preview';
import type { DecodedPng } from '#/utils/image/png-decode';

const SGR_RE = /\u001B\[[0-9;]*m/g;

function solid(width: number, height: number, r: number, g: number, b: number): DecodedPng {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return { width, height, pixels };
}

describe('renderHalfBlockPreview', () => {
  it('renders a solid red 4×4 image as red foreground + background cells', () => {
    const lines = renderHalfBlockPreview(solid(4, 4, 255, 0, 0), {
      maxWidth: 4,
      maxHeightRows: 2,
      truecolor: true,
    });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      // SGR dedup keeps one fg/bg pair per line; every cell is red.
      expect(line).toBe('\u001B[38;2;255;0;0m\u001B[48;2;255;0;0m▀▀▀▀\u001B[0m');
    }
  });

  it('scales a 100×10 image to 40 cells wide and 2 lines', () => {
    const lines = renderHalfBlockPreview(solid(100, 10, 0, 128, 255), {
      maxWidth: 40,
      maxHeightRows: 12,
      truecolor: false,
    });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.replaceAll(SGR_RE, '')).toBe('▀'.repeat(40));
    }
  });

  it('quantizes to the 6×6×6 cube when truecolor is unavailable', () => {
    const lines = renderHalfBlockPreview(solid(2, 2, 255, 0, 0), {
      maxWidth: 2,
      maxHeightRows: 1,
      truecolor: false,
    });

    // 16 + 36*5 + 6*0 + 0 = 196 (pure red cube entry).
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('38;5;196');
    expect(lines[0]).toContain('48;5;196');
  });
});
