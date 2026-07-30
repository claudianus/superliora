export interface ResponsesApiPayload {
  readonly output_text?: string;
  readonly output?: readonly ResponsesOutputItem[];
}

interface ResponsesOutputItem {
  readonly type?: string;
  readonly content?: readonly ResponsesContentPart[];
  readonly text?: string;
}

interface ResponsesContentPart {
  readonly type?: string;
  readonly text?: string;
  readonly annotations?: readonly ResponsesAnnotation[];
}

interface ResponsesAnnotation {
  readonly type?: string;
  readonly url?: string;
  readonly title?: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function extractResponsesText(payload: ResponsesApiPayload): string {
  const direct = nonEmpty(payload.output_text);
  if (direct !== undefined) return direct;

  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    if (typeof item.text === 'string' && item.text.length > 0) {
      chunks.push(item.text);
    }
    for (const part of item.content ?? []) {
      if (
        (part.type === 'output_text' || part.type === 'text' || part.type === undefined) &&
        typeof part.text === 'string' &&
        part.text.length > 0
      ) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

export function extractResponsesCitations(payload: ResponsesApiPayload): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        const url = nonEmpty(annotation.url);
        if (url === undefined) continue;
        if (annotation.type !== undefined && annotation.type !== 'url_citation') continue;
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

const VALID_IMAGE_ASPECT_RATIOS = new Set([
  '1:1',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  'auto',
]);

const VALID_VIDEO_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '3:2', '2:3']);
const VALID_VIDEO_RESOLUTIONS = new Set(['480p', '720p']);
const VALID_VIDEO_DURATIONS = new Set([6, 10]);

export function normalizeImageAspectRatio(value: string | undefined): string {
  const raw = nonEmpty(value) ?? 'auto';
  return VALID_IMAGE_ASPECT_RATIOS.has(raw) ? raw : 'auto';
}

export function normalizeVideoAspectRatio(value: string | undefined): string | undefined {
  const raw = nonEmpty(value);
  if (raw === undefined) return undefined;
  return VALID_VIDEO_ASPECT_RATIOS.has(raw) ? raw : '16:9';
}

export function normalizeVideoResolution(value: string | undefined): string {
  const raw = (nonEmpty(value) ?? '480p').toLowerCase();
  if (raw === '720p' || raw === '720') return '720p';
  if (VALID_VIDEO_RESOLUTIONS.has(raw)) return raw;
  return '480p';
}

export function normalizeVideoDuration(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return 6;
  const rounded = Math.round(value);
  if (VALID_VIDEO_DURATIONS.has(rounded)) return rounded;
  return rounded >= 8 ? 10 : 6;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
