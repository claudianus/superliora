import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  FsEntry,
  FsListRequest,
} from '@superliora/protocol';

import {
  FsAlreadyExistsError,
  FsIsBinaryError,
  FsIsDirectoryError,
  FsPathNotFoundError,
  FsTooLargeError,
  FsTooManyResultsError,
} from './fs';

export const FS_BINARY_NONPRINTABLE_FRACTION = 0.3;

const HIDDEN_NAME_RE = /^\./;
const MACOS_NOISE = new Set(['.DS_Store', '.AppleDouble', '.LSOverride']);

export function isHidden(name: string): boolean {
  return HIDDEN_NAME_RE.test(name) || MACOS_NOISE.has(name);
}

export function sortDirents(
  ds: import('node:fs').Dirent[],
  sort: FsListRequest['sort'],
): void {
  const cmp = {
    type_first: (a: import('node:fs').Dirent, b: import('node:fs').Dirent) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    },
    name_asc: (a: import('node:fs').Dirent, b: import('node:fs').Dirent) =>
      a.name.localeCompare(b.name),
    name_desc: (a: import('node:fs').Dirent, b: import('node:fs').Dirent) =>
      b.name.localeCompare(a.name),

    mtime_desc: (a: import('node:fs').Dirent, b: import('node:fs').Dirent) =>
      a.name.localeCompare(b.name),
    size_desc: (a: import('node:fs').Dirent, b: import('node:fs').Dirent) =>
      a.name.localeCompare(b.name),
  }[sort];
  ds.sort(cmp);
}

export function matchesAnyGlob(rel: string, globs: readonly string[]): boolean {
  for (const g of globs) {
    if (globToRegExp(g).test(rel)) return true;
  }
  return false;
}

export function globToRegExp(glob: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (glob[i] === '/') i++;
    } else if (ch === '*') {
      re += '[^/]*';
      i++;
    } else if (ch === '?') {
      re += '[^/]';
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

export async function buildFsEntry(
  relPath: string,
  name: string,
  absPath: string,
  dirent: import('node:fs').Dirent,
  withMimeAndBinary: boolean,
): Promise<FsEntry> {
  let st: import('node:fs').Stats | undefined;
  try {
    st = await fs.lstat(absPath);
  } catch {

  }
  return buildFsEntryFromDirentAndStat(
    relPath,
    name,
    absPath,
    dirent,
    st,
    withMimeAndBinary,
  );
}

export function buildFsEntryFromDirentAndStat(
  relPath: string,
  name: string,
  absPath: string,
  dirent: import('node:fs').Dirent,
  st: import('node:fs').Stats | undefined,
  withMimeAndBinary: boolean,
): FsEntry {
  const kind: FsEntry['kind'] = dirent.isSymbolicLink()
    ? 'symlink'
    : dirent.isDirectory()
      ? 'directory'
      : 'file';
  const entry: FsEntry = {
    path: relPath,
    name,
    kind,
    modified_at: st ? new Date(st.mtimeMs).toISOString() : new Date(0).toISOString(),
  };
  if (kind === 'file' && st !== undefined) {
    entry.size = st.size;
  }
  if (st !== undefined) {
    entry.etag = buildEtag(st);
  }
  if (withMimeAndBinary && kind === 'file') {
    entry.mime = guessMime(relPath, false);
    const lang = guessLanguageId(relPath);
    if (lang !== undefined) entry.language_id = lang;
  }
  void absPath;
  return entry;
}

export function buildFsEntryFromStat(
  relPath: string,
  name: string,
  absPath: string,
  st: import('node:fs').Stats,
  withMimeAndBinary: boolean,
): FsEntry {

  const kind: FsEntry['kind'] = st.isDirectory() ? 'directory' : 'file';
  const entry: FsEntry = {
    path: relPath,
    name,
    kind,
    modified_at: new Date(st.mtimeMs).toISOString(),
    etag: buildEtag(st),
  };
  if (kind === 'file') {
    entry.size = st.size;
  }
  if (withMimeAndBinary && kind === 'file') {
    entry.mime = guessMime(relPath, false);
    const lang = guessLanguageId(relPath);
    if (lang !== undefined) entry.language_id = lang;
  }
  void absPath;
  return entry;
}

export function buildEtag(st: import('node:fs').Stats): string {

  return [
    Math.floor(st.mtimeMs).toString(36),
    st.size.toString(36),
    st.ino.toString(36),
  ].join('-');
}

export function detectBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    if (b === 0) return true;

    if (b === 9 || b === 10 || b === 13) continue;
    if (b >= 32 && b <= 126) continue;

    nonPrintable++;
  }
  return nonPrintable / buf.length > FS_BINARY_NONPRINTABLE_FRACTION;
}

export async function readFileRange(
  absPath: string,
  start: number,
  end: number,
): Promise<Buffer> {
  if (end <= start) return Buffer.alloc(0);
  const fh = await fs.open(absPath, 'r');
  try {
    const length = end - start;
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'application/toml',
  '.sh': 'text/x-shellscript',
  '.py': 'text/x-python',
  '.rs': 'text/rust',
  '.go': 'text/x-go',
};

export function guessMime(relPath: string, isBinary: boolean): string {
  const ext = path.extname(relPath).toLowerCase();
  const mapped = EXT_TO_MIME[ext];
  if (mapped !== undefined) return mapped;
  return isBinary ? 'application/octet-stream' : 'text/plain';
}

const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.sh': 'shellscript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
};

export function guessLanguageId(relPath: string): string | undefined {
  return EXT_TO_LANGUAGE[path.extname(relPath).toLowerCase()];
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }

  if (text.charCodeAt(text.length - 1) === 10) n--;
  return Math.max(0, n);
}

export function mapStatError(err: unknown, inputPath: string): Error {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new FsPathNotFoundError(inputPath);
  }
  return err as Error;
}

export function mapToWireError(err: unknown): { code: number; msg: string } {
  if (err instanceof FsPathNotFoundError) {
    return { code: 40409, msg: err.message };
  }
  if (err instanceof FsIsDirectoryError) {
    return { code: 40906, msg: err.message };
  }
  if (err instanceof FsIsBinaryError) {
    return { code: 40907, msg: err.message };
  }
  if (err instanceof FsTooLargeError) {
    return { code: 41302, msg: err.message };
  }
  if (err instanceof FsTooManyResultsError) {
    return { code: 41303, msg: err.message };
  }
  return { code: 50001, msg: (err as Error)?.message ?? 'internal error' };
}
