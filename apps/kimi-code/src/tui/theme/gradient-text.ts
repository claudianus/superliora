import { renderRendererGradientTextAnsi } from '#/tui/renderer';

export function gradientText(
  text: string,
  fromHex: string,
  toHex: string,
  accentBias = 1,
  offset = 0,
): string {
  return renderRendererGradientTextAnsi(text, {
    from: fromHex,
    to: toHex,
    accentBias,
    offset,
  });
}
