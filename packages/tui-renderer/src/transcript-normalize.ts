export function normalizeTranscriptWidth(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function normalizeTranscriptPadding(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : 0;
}

export function normalizeTranscriptLineCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function normalizeMinContentWidth(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : 1;
}

export function normalizePreviewLineCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function normalizeOptionalPreviewLineCount(value: number | undefined): number | undefined {
  return value === undefined ? undefined : normalizePreviewLineCount(value);
}
