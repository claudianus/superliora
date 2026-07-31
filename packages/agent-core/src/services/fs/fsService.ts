

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import type {
  FsEntry,
  FsListManyRequest,
  FsListManyResponse,
  FsListRequest,
  FsListResponse,
  FsMkdirRequest,
  FsReadRequest,
  FsReadResponse,
  FsStatManyRequest,
  FsStatManyResponse,
  FsStatRequest,
} from '@superliora/protocol';
import ignore, { type Ignore } from 'ignore';

import { ISessionService, SessionNotFoundError } from '../session/session';

import {
  IFsService,
  FsAlreadyExistsError,
  FsPathNotFoundError,
  FsIsDirectoryError,
  FsIsBinaryError,
  FsTooLargeError,
  FsTooManyResultsError,
  type FsDownloadResolved,
  type FsPathResolved,
} from './fs';
import { FsPathEscapesError, resolveSafePath } from './fsPathSafety';
import {
  buildFsEntry,
  buildFsEntryFromDirentAndStat,
  buildFsEntryFromStat,
  buildEtag,
  countLines,
  detectBinary,
  guessLanguageId,
  guessMime,
  isHidden,
  mapStatError,
  mapToWireError,
  matchesAnyGlob,
  readFileRange,
  sortDirents,
} from './fsServiceHelpers';

const FS_READ_MAX_BYTES = 10 * 1024 * 1024;

const FS_BINARY_SAMPLE_BYTES = 4096;

export class FsService extends Disposable implements IFsService {
  readonly _serviceBrand: undefined;

  protected gitignoreCache = new Map<string, Ignore>();

  constructor(@ISessionService protected readonly sessions: ISessionService) {
    super();
  }

  override dispose(): void {
    this.gitignoreCache.clear();
    super.dispose();
  }

  async list(sessionId: string, req: FsListRequest): Promise<FsListResponse> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const safe = await resolveSafePath(cwd, req.path);

    let topStat: import('node:fs').Stats;
    try {
      topStat = await fs.stat(safe.absolute);
    } catch (error) {
      throw mapStatError(error, req.path);
    }
    if (!topStat.isDirectory()) {

      throw new FsPathNotFoundError(req.path);
    }

    const realCwd = await fs.realpath(cwd);
    const matcher = req.follow_gitignore ? await this.matcher(realCwd) : undefined;

    const items: FsEntry[] = [];
    const childrenByPath: Record<string, FsEntry[]> = {};
    let truncated = false;

    interface QueueEntry {
      absPath: string;

      relPath: string;
      depthRemaining: number;
    }
    const queue: QueueEntry[] = [
      {
        absPath: safe.absolute,
        relPath: safe.relative === '.' ? '' : safe.relative,
        depthRemaining: req.depth,
      },
    ];

    while (queue.length > 0) {
      const entry = queue.shift()!;
      let dirents: import('node:fs').Dirent[];
      try {
        dirents = await fs.readdir(entry.absPath, { withFileTypes: true });
      } catch (error) {

        if (entry.absPath === safe.absolute) {
          throw mapStatError(error, req.path);
        }
        continue;
      }

      const visible: import('node:fs').Dirent[] = [];
      for (const d of dirents) {
        if (!req.show_hidden && isHidden(d.name)) continue;
        const childRel = entry.relPath === '' ? d.name : `${entry.relPath}/${d.name}`;
        if (matcher) {

          const probe = d.isDirectory() ? `${childRel}/` : childRel;
          if (matcher.ignores(probe)) continue;
        }
        if (req.exclude_globs && matchesAnyGlob(childRel, req.exclude_globs)) {
          continue;
        }
        visible.push(d);
      }

      sortDirents(visible, req.sort);

      const parentKey = entry.relPath === '' ? '.' : entry.relPath;
      const bucket: FsEntry[] = [];
      for (const d of visible) {
        if (items.length >= req.limit && entry.depthRemaining === req.depth) {
          truncated = true;
          break;
        }
        const childRel = entry.relPath === '' ? d.name : `${entry.relPath}/${d.name}`;
        const childAbs = path.join(entry.absPath, d.name);
        const fsEntry = await buildFsEntry(childRel, d.name, childAbs, d, false);
        if (entry.depthRemaining === req.depth) {

          items.push(fsEntry);
        }
        bucket.push(fsEntry);
        if (d.isDirectory() && entry.depthRemaining > 1) {
          queue.push({
            absPath: childAbs,
            relPath: childRel,
            depthRemaining: entry.depthRemaining - 1,
          });
        }
      }

      if (entry.depthRemaining < req.depth) {
        childrenByPath[parentKey] = bucket;
      }
    }

    const response: FsListResponse = { items, truncated };
    if (Object.keys(childrenByPath).length > 0) {
      response.children_by_path = childrenByPath;
    }
    return response;
  }

  async read(sessionId: string, req: FsReadRequest): Promise<FsReadResponse> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const safe = await resolveSafePath(cwd, req.path);

    let st: import('node:fs').Stats;
    try {
      st = await fs.stat(safe.absolute);
    } catch (error) {
      throw mapStatError(error, req.path);
    }
    if (st.isDirectory()) {
      throw new FsIsDirectoryError(req.path);
    }
    if (st.size > FS_READ_MAX_BYTES) {
      throw new FsTooLargeError(req.path, st.size);
    }

    const sampleSize = Math.min(FS_BINARY_SAMPLE_BYTES, st.size);
    const sample = await readFileRange(safe.absolute, 0, sampleSize);
    const isBinaryHeuristic = detectBinary(sample);

    if (isBinaryHeuristic && req.encoding === 'utf-8') {

      throw new FsIsBinaryError(req.path);
    }

    const effectiveLength = Math.min(req.length, st.size - req.offset);
    const bytes =
      effectiveLength <= 0
        ? Buffer.alloc(0)
        : await readFileRange(
            safe.absolute,
            req.offset,
            req.offset + effectiveLength,
          );

    const encoding: 'utf-8' | 'base64' =
      req.encoding === 'base64' || (req.encoding === 'auto' && isBinaryHeuristic)
        ? 'base64'
        : 'utf-8';
    const content = encoding === 'utf-8' ? bytes.toString('utf-8') : bytes.toString('base64');
    const truncated = req.offset + effectiveLength < st.size;

    const mime = guessMime(safe.relative, isBinaryHeuristic);
    const languageId = encoding === 'utf-8' ? guessLanguageId(safe.relative) : undefined;
    const etag = buildEtag(st);

    const out: FsReadResponse = {
      path: safe.relative,
      content,
      encoding,
      size: st.size,
      truncated,
      etag,
      mime,
      is_binary: isBinaryHeuristic,
    };
    if (languageId !== undefined) out.language_id = languageId;
    if (encoding === 'utf-8') {
      out.line_count = countLines(content);
    }
    return out;
  }

  async listMany(
    sessionId: string,
    req: FsListManyRequest,
  ): Promise<FsListManyResponse> {

    await this.sessions.get(sessionId);

    const results: Record<string, FsEntry[]> = {};
    const partialErrors: Record<string, { code: number; msg: string }> = {};
    const truncatedPaths: string[] = [];

    await Promise.all(
      req.paths.map(async (p) => {
        try {
          const sub = await this.list(sessionId, {
            path: p,
            depth: req.depth,
            limit: req.limit,
            show_hidden: req.show_hidden,
            follow_gitignore: req.follow_gitignore,
            exclude_globs: req.exclude_globs,
            sort: req.sort,
            include_git_status: req.include_git_status,
          });
          results[p] = sub.items;
          if (sub.truncated) truncatedPaths.push(p);
        } catch (error) {

          if (error instanceof FsPathEscapesError) throw error;
          if (error instanceof SessionNotFoundError) throw error;
          partialErrors[p] = mapToWireError(error);
        }
      }),
    );

    const out: FsListManyResponse = { results };
    if (truncatedPaths.length > 0) out.truncated_paths = truncatedPaths;
    if (Object.keys(partialErrors).length > 0) out.partial_errors = partialErrors;
    return out;
  }

  async stat(sessionId: string, req: FsStatRequest): Promise<FsEntry> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const safe = await resolveSafePath(cwd, req.path);
    let st: import('node:fs').Stats;
    try {
      st = await fs.stat(safe.absolute);
    } catch (error) {
      throw mapStatError(error, req.path);
    }
    const name =
      safe.relative === '.' ? path.basename(cwd) : path.basename(safe.absolute);

    return buildFsEntryFromStat(safe.relative, name, safe.absolute, st, true);
  }

  async statMany(
    sessionId: string,
    req: FsStatManyRequest,
  ): Promise<FsStatManyResponse> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;

    const resolved = await Promise.all(
      req.paths.map(async (p) => ({
        raw: p,
        safe: await resolveSafePath(cwd, p),
      })),
    );

    const stats = await Promise.all(
      resolved.map(async ({ raw, safe }) => {
        try {
          const st = await fs.stat(safe.absolute);
          const name =
            safe.relative === '.'
              ? path.basename(cwd)
              : path.basename(safe.absolute);
          return {
            raw,
            entry: buildFsEntryFromStat(
              safe.relative,
              name,
              safe.absolute,
              st,
               false,
            ),
          };
        } catch {

          return { raw, entry: null };
        }
      }),
    );

    const entries: Record<string, FsEntry | null> = {};
    for (const { raw, entry } of stats) {
      entries[raw] = entry;
    }
    return { entries };
  }

  async mkdir(sessionId: string, req: FsMkdirRequest): Promise<FsEntry> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const safe = await resolveSafePath(cwd, req.path);

    try {
      await fs.mkdir(safe.absolute, { recursive: req.recursive });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new FsAlreadyExistsError(req.path);
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // Non-recursive mkdir whose parent is missing / not a directory.
        throw new FsPathNotFoundError(req.path);
      }
      throw error;
    }

    const st = await fs.stat(safe.absolute);
    const name = path.basename(safe.absolute);
    return buildFsEntryFromStat(safe.relative, name, safe.absolute, st, false);
  }

  async resolveDownload(
    sessionId: string,
    relPath: string,
  ): Promise<FsDownloadResolved> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const safe = await resolveSafePath(cwd, relPath);
    let st: import('node:fs').Stats;
    try {
      st = await fs.stat(safe.absolute);
    } catch (error) {
      throw mapStatError(error, relPath);
    }
    if (st.isDirectory()) {
      throw new FsIsDirectoryError(relPath);
    }

    const sampleSize = Math.min(FS_BINARY_SAMPLE_BYTES, st.size);
    const sample =
      sampleSize === 0
        ? Buffer.alloc(0)
        : await readFileRange(safe.absolute, 0, sampleSize);
    const isBinary = detectBinary(sample);

    return {
      absolute: safe.absolute,
      relative: safe.relative,
      size: st.size,
      etag: buildEtag(st),
      mime: guessMime(safe.relative, isBinary),
      modifiedAt: new Date(st.mtimeMs),
    };
  }

  async resolvePath(
    sessionId: string,
    relPath: string,
  ): Promise<FsPathResolved> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const safe = await resolveSafePath(cwd, relPath);
    let st: import('node:fs').Stats;
    try {
      st = await fs.stat(safe.absolute);
    } catch (error) {
      throw mapStatError(error, relPath);
    }
    return {
      absolute: safe.absolute,
      relative: safe.relative,
      isDirectory: st.isDirectory(),
    };
  }

  protected async matcher(realCwd: string): Promise<Ignore | undefined> {
    const cached = this.gitignoreCache.get(realCwd);
    if (cached !== undefined) return cached;
    const ig = ignore();

    ig.add('.git/');
    try {
      const contents = await fs.readFile(path.join(realCwd, '.gitignore'), 'utf-8');
      ig.add(contents);
    } catch {

    }
    this.gitignoreCache.set(realCwd, ig);
    return ig;
  }
}


registerSingleton(IFsService, FsService, InstantiationType.Delayed);
