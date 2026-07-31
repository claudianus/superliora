/**
 * OpenCode-style patch parse/apply helpers (pure string logic for tests).
 *
 * Format:
 *   *** Begin Patch
 *   *** Update File: path/to/file.ts
 *   @@
 *    context
 *   -old
 *   +new
 *   *** Add File: path/new.ts
 *   +line
 *   *** Delete File: path/remove.ts
 *   *** End Patch
 */

export type PatchFileKind = 'update' | 'add' | 'delete';

export interface PatchHunk {
  readonly lines: readonly PatchHunkLine[];
}

export interface PatchHunkLine {
  readonly type: 'context' | 'remove' | 'add';
  readonly text: string;
}

export interface PatchFileChange {
  readonly path: string;
  readonly kind: PatchFileKind;
  readonly hunks: readonly PatchHunk[];
}

export type ParsePatchResult =
  | { ok: true; files: readonly PatchFileChange[] }
  | { ok: false; error: string };

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const FILE_HEADER =
  /^\*\*\* (Update File|Add File|Delete File): (.+)$/;

export function parseOpenCodePatch(raw: string): ParsePatchResult {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith(BEGIN)) {
    return { ok: false, error: 'Patch must start with *** Begin Patch' };
  }
  if (!normalized.includes(END)) {
    return { ok: false, error: 'Patch must end with *** End Patch' };
  }

  const body = normalized.slice(BEGIN.length, normalized.indexOf(END)).trim();
  if (body.length === 0) {
    return { ok: false, error: 'Patch body is empty' };
  }

  const files: PatchFileChange[] = [];
  let current: PatchFileChange | undefined;
  let currentHunk: PatchHunkLine[] | undefined;

  const flushHunk = () => {
    if (current === undefined || currentHunk === undefined || currentHunk.length === 0) {
      currentHunk = undefined;
      return;
    }
    const next: PatchFileChange = {
      ...current,
      hunks: [...current.hunks, { lines: currentHunk }],
    };
    files[files.length - 1] = next;
    current = next;
    currentHunk = undefined;
  };

  const flushFile = () => {
    flushHunk();
    current = undefined;
  };

  for (const line of body.split('\n')) {
    const fileMatch = line.match(FILE_HEADER);
    if (fileMatch) {
      flushFile();
      const kindToken = fileMatch[1];
      const path = fileMatch[2]?.trim() ?? '';
      if (path.length === 0) {
        return { ok: false, error: 'Patch file header missing path' };
      }
      const kind: PatchFileKind =
        kindToken === 'Add File' ? 'add' : kindToken === 'Delete File' ? 'delete' : 'update';
      current = { path, kind, hunks: [] };
      files.push(current);
      continue;
    }

    if (current === undefined) {
      return { ok: false, error: `Unexpected line before file header: ${line}` };
    }

    if (line === '@@') {
      flushHunk();
      currentHunk = [];
      continue;
    }

    if (current.kind === 'delete') {
      if (line.trim().length > 0) {
        return { ok: false, error: `Delete File sections must not contain body lines: ${line}` };
      }
      continue;
    }

    if (currentHunk === undefined) {
      if (current.kind === 'add') {
        currentHunk = [];
      } else {
        return { ok: false, error: `Hunk must start with @@ in ${current.path}: ${line}` };
      }
    }

    const parsed = parseHunkLine(line);
    if (parsed === null) {
      return { ok: false, error: `Invalid hunk line in ${current.path}: ${line}` };
    }
    currentHunk.push(parsed);
  }

  flushFile();

  if (files.length === 0) {
    return { ok: false, error: 'Patch contains no file sections' };
  }

  for (const file of files) {
    if (file.kind === 'delete') continue;
    if (file.hunks.length === 0) {
      return { ok: false, error: `File section ${file.path} has no hunks` };
    }
    for (const hunk of file.hunks) {
      const hasAdd = hunk.lines.some((l) => l.type === 'add');
      const hasRemove = hunk.lines.some((l) => l.type === 'remove');
      if (file.kind === 'add' && hasRemove) {
        return { ok: false, error: `Add File ${file.path} cannot contain removals` };
      }
      if (file.kind === 'update' && !hasAdd && !hasRemove) {
        return { ok: false, error: `Hunk in ${file.path} makes no changes` };
      }
    }
  }

  return { ok: true, files };
}

function parseHunkLine(line: string): PatchHunkLine | null {
  if (line.length === 0) {
    return { type: 'context', text: '' };
  }
  const marker = line[0];
  if (marker === ' ') return { type: 'context', text: line.slice(1) };
  if (marker === '-') return { type: 'remove', text: line.slice(1) };
  if (marker === '+') return { type: 'add', text: line.slice(1) };
  return null;
}

export function hunkBlocks(hunk: PatchHunk): { oldBlock: string; newBlock: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of hunk.lines) {
    if (line.type === 'context' || line.type === 'remove') oldLines.push(line.text);
    if (line.type === 'context' || line.type === 'add') newLines.push(line.text);
  }
  return { oldBlock: oldLines.join('\n'), newBlock: newLines.join('\n') };
}

export type ApplyHunksResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/** Apply hunks sequentially to one file's text content. */
export function applyHunksToContent(content: string, hunks: readonly PatchHunk[]): ApplyHunksResult {
  let next = content;
  for (let i = 0; i < hunks.length; i++) {
    const { oldBlock, newBlock } = hunkBlocks(hunks[i]!);
    if (oldBlock.length === 0 && newBlock.length > 0) {
      next = next.length === 0 ? newBlock : `${next}\n${newBlock}`;
      continue;
    }
    const index = next.indexOf(oldBlock);
    if (index === -1) {
      return {
        ok: false,
        error: `Hunk ${String(i + 1)} did not match file content. Re-Read the file and rebuild the patch.`,
      };
    }
    const tail = next.indexOf(oldBlock, index + oldBlock.length);
    if (tail !== -1) {
      return {
        ok: false,
        error: `Hunk ${String(i + 1)} is ambiguous (multiple matches). Add surrounding context lines.`,
      };
    }
    next = next.slice(0, index) + newBlock + next.slice(index + oldBlock.length);
  }
  return { ok: true, content: next };
}

export function applyPatchToFileMap(
  files: ReadonlyMap<string, string>,
  changes: readonly PatchFileChange[],
): { ok: true; updates: Map<string, string | null> } | { ok: false; error: string } {
  const updates = new Map<string, string | null>();
  for (const change of changes) {
    if (change.kind === 'delete') {
      updates.set(change.path, null);
      continue;
    }
    const existing = files.get(change.path) ?? '';
    if (change.kind === 'update' && !files.has(change.path)) {
      return { ok: false, error: `Update File ${change.path} not found. Use Add File for new paths.` };
    }
    const applied = applyHunksToContent(existing, change.hunks);
    if (!applied.ok) {
      return { ok: false, error: `${change.path}: ${applied.error}` };
    }
    updates.set(change.path, applied.content);
  }
  return { ok: true, updates };
}
