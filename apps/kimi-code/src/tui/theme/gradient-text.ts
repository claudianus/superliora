import chalk from 'chalk';

interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export function gradientText(
  text: string,
  fromHex: string,
  toHex: string,
  accentBias = 1,
  offset = 0,
): string {
  const chars = Array.from(text);
  const from = parseHexColor(fromHex);
  const to = parseHexColor(toHex);
  if (chars.length <= 1 || from === undefined || to === undefined) {
    return chalk.hex(fromHex).bold(text);
  }
  const safeAccentBias = Number.isFinite(accentBias) ? Math.max(0, accentBias) : 1;
  const safeOffset = Number.isFinite(offset) ? Math.trunc(offset) : 0;
  return chars.map((char, index) => {
    const shiftedIndex = positiveModulo(index + safeOffset, chars.length);
    const ratio = Math.min(1, (shiftedIndex / (chars.length - 1)) * safeAccentBias);
    return chalk.hex(interpolateHexColor(from, to, ratio)).bold(char);
  }).join('');
}

function parseHexColor(hex: string): RgbColor | undefined {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (match === null) return undefined;
  return {
    red: Number.parseInt(match[1]!, 16),
    green: Number.parseInt(match[2]!, 16),
    blue: Number.parseInt(match[3]!, 16),
  };
}

function interpolateHexColor(from: RgbColor, to: RgbColor, ratio: number): string {
  const mix = (start: number, end: number): string =>
    Math.round(start + (end - start) * ratio)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(from.red, to.red)}${mix(from.green, to.green)}${mix(from.blue, to.blue)}`;
}

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}
