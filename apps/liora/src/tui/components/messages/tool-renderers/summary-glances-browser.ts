import type { GlanceFn } from './summary-glances';

export const runProjectChecksGlance: GlanceFn = (_toolCall, result) => {
  const start = result.output.indexOf('{');
  if (start >= 0) {
    try {
      const json = JSON.parse(result.output.slice(start)) as Record<string, unknown>;
      if (typeof json['summary'] === 'string' && json['summary'].length > 0) {
        return json['summary'].replaceAll(/\s+/g, ' ').trim().slice(0, 72);
      }
      const exitCode = typeof json['exitCode'] === 'number' ? json['exitCode'] : undefined;
      const checks = Array.isArray(json['checks']) ? json['checks'].length : undefined;
      const parts: string[] = [];
      if (exitCode !== undefined) parts.push(exitCode === 0 ? 'pass' : `exit ${exitCode}`);
      if (checks !== undefined) parts.push(`${checks} checks`);
      if (parts.length > 0) return parts.join(' · ');
    } catch {
      // fall through
    }
  }
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const verifySurfaceGlance: GlanceFn = (_toolCall, result) => {
  const start = result.output.indexOf('{');
  if (start >= 0) {
    try {
      const json = JSON.parse(result.output.slice(start)) as Record<string, unknown>;
      const pass = json['pass'] === true;
      const url = typeof json['url'] === 'string' ? json['url'] : '';
      const errors = Array.isArray(json['consoleErrors']) ? json['consoleErrors'].length : 0;
      const parts: string[] = [pass ? 'pass' : 'fail'];
      if (url.length > 0) {
        try {
          parts.push(new URL(url).host);
        } catch {
          parts.push(url.slice(0, 32));
        }
      }
      if (errors > 0) parts.push(`${errors} console`);
      return parts.join(' · ');
    } catch {
      // fall through
    }
  }
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const visualDiffGlance: GlanceFn = (_toolCall, result) => {
  const start = result.output.indexOf('{');
  if (start >= 0) {
    try {
      const json = JSON.parse(result.output.slice(start)) as Record<string, unknown>;
      const summary = typeof json['summary'] === 'string' ? json['summary'].trim() : '';
      if (summary.length > 0) return summary.slice(0, 96);
      const status = typeof json['status'] === 'string' ? json['status'].replaceAll('_', ' ') : '';
      const identical = json['identical'] === true;
      const delta = typeof json['lengthDelta'] === 'number' ? json['lengthDelta'] : undefined;
      const prefix =
        typeof json['sharedPrefixRatio'] === 'number'
          ? Math.round(json['sharedPrefixRatio'] * 100)
          : undefined;
      const parts: string[] = [status.length > 0 ? status : identical ? 'identical' : 'differ'];
      if (delta !== undefined && delta > 0) parts.push(`Δ${String(delta)}B`);
      if (prefix !== undefined && !identical) parts.push(`prefix ${String(prefix)}%`);
      return parts.join(' · ');
    } catch {
      // fall through
    }
  }
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const browserStatusGlance: GlanceFn = (_toolCall, result) => {
  const json = (() => {
    const start = result.output.indexOf('{');
    if (start < 0) return undefined;
    try {
      return JSON.parse(result.output.slice(start)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  })();
  if (json === undefined) return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
  const url = typeof json['url'] === 'string' ? json['url'] : '';
  const title = typeof json['title'] === 'string' ? json['title'] : '';
  if (url.length > 0 && title.length > 0) {
    try {
      return `${new URL(url).host} · ${title.slice(0, 40)}`;
    } catch {
      return `${url.slice(0, 40)} · ${title.slice(0, 40)}`;
    }
  }
  if (url.length > 0) return url.slice(0, 72);
  if (title.length > 0) return title.slice(0, 72);
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const browserObserveGlance: GlanceFn = (_toolCall, result) => {
  const start = result.output.indexOf('{');
  if (start < 0) return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
  try {
    const json = JSON.parse(result.output.slice(start)) as Record<string, unknown>;
    const title = typeof json['title'] === 'string' ? json['title'] : '';
    const refs = Array.isArray(json['refs']) ? json['refs'].length : undefined;
    const parts: string[] = [];
    if (title.length > 0) parts.push(title.slice(0, 40));
    if (refs !== undefined) parts.push(`${refs} refs`);
    if (parts.length > 0) return parts.join(' · ');
  } catch {
    // fall through
  }
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const computerCaptureGlance: GlanceFn = (_toolCall, result) => {
  const start = result.output.indexOf('{');
  if (start < 0) return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
  try {
    const json = JSON.parse(result.output.slice(start)) as Record<string, unknown>;
    const mode = typeof json['mode'] === 'string' ? json['mode'] : '';
    const app = typeof json['app'] === 'string' ? json['app'] : '';
    const title = typeof json['windowTitle'] === 'string' ? json['windowTitle'] : '';
    const parts: string[] = [];
    if (mode.length > 0) parts.push(mode);
    if (app.length > 0) parts.push(app);
    if (title.length > 0) parts.push(title.slice(0, 40));
    if (parts.length > 0) return parts.join(' · ');
  } catch {
    // fall through
  }
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

export const generateMediaGlance: GlanceFn = (_toolCall, result) => {
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Path:')) return trimmed.slice('Path:'.length).trim();
  }
  return '';
};
