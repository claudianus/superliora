export function normalizeContentRows(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeViewportRows(value: number | undefined): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeOffsetRows(value: number | undefined): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeScrollTop(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function normalizeSelectedIndex(value: number | undefined, itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (value === Number.POSITIVE_INFINITY) return itemCount - 1;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return clamp(Math.floor(value), 0, itemCount - 1);
}

export function normalizeScrollPadding(value: number | undefined, viewportRows: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  if (viewportRows <= 1) return 0;
  return clamp(Math.floor(value), 0, Math.floor((viewportRows - 1) / 2));
}

export function normalizePositiveRows(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

export function normalizeSignedRows(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

export function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mod(value: number, modulus: number): number {
  if (modulus <= 0) return 0;
  return ((value % modulus) + modulus) % modulus;
}
