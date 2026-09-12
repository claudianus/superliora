/**
 * Shared sRGB luminance helpers for theme detection.
 *
 * Every "is this background dark?" decision (terminal background probe, Shiki
 * palette type, imported theme base inference) must go through this module so
 * the three classifiers agree on the same hex. The old per-site formulas summed
 * gamma-encoded channels — a #808080 background scored 0.50/0.55 and flipped to
 * the light palette while its WCAG linear luminance is 0.216 (plainly dark).
 */

/**
 * WCAG 2.x sRGB channel linearization. Input in [0,1] gamma-encoded, output
 * linear-light.
 */
export function linearizeSrgbChannel(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance from gamma-encoded sRGB channels in [0,1].
 */
export function relativeLuminanceSrgb(r: number, g: number, b: number): number {
  return (
    0.2126 * linearizeSrgbChannel(r) +
    0.7152 * linearizeSrgbChannel(g) +
    0.0722 * linearizeSrgbChannel(b)
  );
}

/**
 * Dark/light split on linear luminance. 0.263 is the linear equivalent of the
 * long-standing gamma-encoded 0.55 midpoint (i.e. mid-gray #8C8C8C and darker
 * reads as dark), so existing classifications of terminal palettes are
 * preserved — only the formerly mis-classified mid grays (#808080–#999999)
 * flip to `dark`, matching the renderer's own relativeLuminance.
 */
export const LIGHT_BACKGROUND_LUMINANCE_THRESHOLD = 0.263;

export function isLightBackgroundLuminance(luminance: number): boolean {
  return luminance > LIGHT_BACKGROUND_LUMINANCE_THRESHOLD;
}

/** Parse `#rrggbb` (with or without `#`) into linear luminance, or null. */
export function hexRelativeLuminance(hex: string): number | undefined {
  const raw = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return undefined;
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  return relativeLuminanceSrgb(r, g, b);
}
