/**
 * Synchronous content loading for the `/files` read-only viewer dialog.
 * Pure-ish: touches the filesystem but never throws — every failure mode
 * (missing path, directory, oversize, binary) is reported as a tagged
 * result the caller can render directly.
 */

import { readFileSync, statSync } from 'node:fs';

export type FileViewerLoadResult =
  | { readonly kind: 'text'; readonly content: string; readonly bytes: number; readonly lineCount: number }
  | { readonly kind: 'binary' }
  | { readonly kind: 'too-large'; readonly bytes: number }
  | { readonly kind: 'error'; readonly message: string };

export interface LoadFileForViewerOptions {
  readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_000_000;
const BINARY_SCAN_BYTES = 8192;

/**
 * Load a file for the viewer. Text results have CRLF/CR normalized to LF;
 * a NUL byte in the first 8 KiB marks the file binary. Files larger than
 * `maxBytes` (default 1 MB) are reported as `too-large` without reading.
 */
export function loadFileForViewer(
  absolutePath: string,
  options?: LoadFileForViewerOptions,
): FileViewerLoadResult {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  let size: number;
  try {
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) return { kind: 'error', message: 'is a directory' };
    if (!stat.isFile()) return { kind: 'error', message: 'not a regular file' };
    size = stat.size;
  } catch (error) {
    return { kind: 'error', message: describeFsError(error) };
  }

  if (size > maxBytes) return { kind: 'too-large', bytes: size };

  let buffer: Buffer;
  try {
    buffer = readFileSync(absolutePath);
  } catch (error) {
    return { kind: 'error', message: describeFsError(error) };
  }

  const scanLength = Math.min(buffer.length, BINARY_SCAN_BYTES);
  for (let index = 0; index < scanLength; index += 1) {
    if (buffer[index] === 0) return { kind: 'binary' };
  }

  const content = buffer.toString('utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lineCount = content.split('\n').length;
  return { kind: 'text', content, bytes: buffer.length, lineCount };
}

function describeFsError(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === 'ENOENT') return 'no such file or directory';
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  if (typeof code === 'string' && code.length > 0) return code;
  return 'unreadable file';
}
