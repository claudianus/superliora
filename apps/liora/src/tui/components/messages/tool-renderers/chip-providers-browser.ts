import {
  pluralize,
  type ChipProvider,
} from './chip-format';

function firstJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start)) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return undefined;
}

export const browserStatusChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  const json = firstJsonObject(result.output);
  if (json?.['ok'] === false) return 'error';
  if (typeof json?.['url'] === 'string' && json['url'].length > 0) {
    try {
      return new URL(json['url']).host;
    } catch {
      return 'browser';
    }
  }
  return 'ready';
};

export const browserObserveChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  const json = firstJsonObject(result.output);
  const refs = json?.['refs'];
  if (Array.isArray(refs)) return pluralize(refs.length, 'ref');
  if (typeof json?.['title'] === 'string' && json['title'].length > 0) return String(json['title']).slice(0, 24);
  return 'observe';
};

export const browserScreenshotChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  if (/data:image\//i.test(result.output) || /image_url/i.test(result.output)) return 'image';
  return 'shot';
};

export const browserActChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  const json = firstJsonObject(result.output);
  if (json?.['ok'] === true) return 'ok';
  if (json?.['ok'] === false) return 'failed';
  return 'acted';
};

export const browserConsoleChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  let count = 0;
  for (const line of result.output.split('\n')) {
    if (line.trim().length > 0) count++;
  }
  return count > 0 ? pluralize(count, 'line') : 'empty';
};

export const computerCaptureChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  const json = firstJsonObject(result.output);
  if (typeof json?.['mode'] === 'string') return String(json['mode']);
  if (/data:image\//i.test(result.output)) return 'image';
  return 'capture';
};

export const computerActChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  const json = firstJsonObject(result.output);
  if (json?.['ok'] === true) return 'ok';
  if (json?.['ok'] === false) return 'failed';
  return 'acted';
};

export const computerStatusChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return 'error';
  const json = firstJsonObject(result.output);
  if (typeof json?.['app'] === 'string' && json['app'].length > 0) return String(json['app']).slice(0, 24);
  if (json?.['ok'] === true) return 'ready';
  return 'status';
};
