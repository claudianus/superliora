import { OSC11_RESPONSE } from "#/tui/constant/terminal";

import {
  isLightBackgroundLuminance,
  relativeLuminanceSrgb,
} from "./luminance";

import type { ResolvedTheme } from "./colors";

export function parseOsc11BackgroundTheme(data: string): ResolvedTheme | null {
  const match = OSC11_RESPONSE.exec(data);
  if (match === null) return null;
  const [, r, g, b] = match;
  if (r === undefined || g === undefined || b === undefined) return null;
  return themeFromHexChannels(r, g, b);
}

export function themeFromHexChannels(rHex: string, gHex: string, bHex: string): ResolvedTheme {
  const r = normalizeChannel(rHex);
  const g = normalizeChannel(gHex);
  const b = normalizeChannel(bHex);
  // WCAG relative luminance: channels must be linearized before the weighted
  // sum. Gamma-encoded sums mis-classified mid grays (#808080 → "light").
  const luma = relativeLuminanceSrgb(r, g, b);
  return isLightBackgroundLuminance(luma) ? "light" : "dark";
}

function normalizeChannel(hex: string): number {
  // OSC 11 channels can be 1-4 hex digits. Scale into [0,1] regardless.
  const max = (1 << (hex.length * 4)) - 1;
  const value = parseInt(hex, 16);
  return Number.isFinite(value) ? value / max : 0;
}
