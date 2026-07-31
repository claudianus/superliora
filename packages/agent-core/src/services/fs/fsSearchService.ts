

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import type {
  FsGrepFileHit,
  FsGrepMatch,
  FsGrepRequest,
  FsGrepResponse,
  FsSearchHit,
  FsSearchRequest,
  FsSearchResponse,
} from '@superliora/protocol';
import ignore, { type Ignore } from 'ignore';

import { ISessionService } from '../session/session';

import { ILogService } from '../logger/logger';
import { IFsSearchService, FsGrepTimeoutError } from './fsSearch';
import {
  compileGrepPattern,
  computeFuzzyScore,
  computeMatchPositions,
  matchesAnyGlob,
  rgPath,
  rgText,
  stripTrailingNewline,
  whichBinary,
  type RgJsonRecord,
} from './fsSearchHelpers';

const SEARCH_HARD_CAP = 500;

const GREP_TIMEOUT_MS = 30_000;

const WALK_MAX_DEPTH = 64;

export class FsSearchService
  extends Disposable
  implements IFsSearchService
{
  readonly _serviceBrand: undefined;

  protected gitignoreCache = new Map<string, Ignore>();

  protected rgPath: string | null | undefined = undefined;

  protected rgMissingWarned = false;

  constructor(
    @ISessionService protected readonly sessions: ISessionService,
    @ILogService protected readonly logger: ILogService,
  ) {
    super();
  }

  override dispose(): void {
    this.gitignoreCache.clear();
    super.dispose();
  }

  async search(
    sessionId: string,
    req: FsSearchRequest,
  ): Promise<FsSearchResponse> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const realCwd = await fs.realpath(cwd);
    const matcher = req.follow_gitignore
      ? await this.matcher(realCwd)
      : undefined;

    const candidates: FsSearchHit[] = [];

    const queryLower = req.query.toLowerCase();
    await this.walk(realCwd, '', matcher, async (relPath, name, kind) => {
      const score = computeFuzzyScore(name, queryLower);
      if (score <= 0) return;
      if (req.include_globs && !matchesAnyGlob(relPath, req.include_globs)) {
        return;
      }
      if (req.exclude_globs && matchesAnyGlob(relPath, req.exclude_globs)) {
        return;
      }
      candidates.push({
        path: relPath,
        name,
        kind,
        score,
        match_positions: computeMatchPositions(relPath, queryLower),
      });
    });

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });

    const effectiveCap = Math.min(req.limit, SEARCH_HARD_CAP);
    const truncated = candidates.length > effectiveCap;
    return {
      items: candidates.slice(0, effectiveCap),
      truncated,
    };
  }

  async grep(sessionId: string, req: FsGrepRequest): Promise<FsGrepResponse> {
    const session = await this.sessions.get(sessionId);
    const cwd = session.metadata.cwd;
    const realCwd = await fs.realpath(cwd);

    const startedAt = Date.now();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, GREP_TIMEOUT_MS);

    try {
      const rg = await this.probeRg();
      if (rg !== null) {
        const out = await this.grepWithRg(
          rg,
          realCwd,
          req,
          abortController.signal,
          startedAt,
        );
        return out;
      }
      const out = await this.grepWithNode(
        realCwd,
        req,
        abortController.signal,
        startedAt,
      );
      return out;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  protected async probeRg(): Promise<string | null> {
    if (this.rgPath !== undefined) return this.rgPath;
    const found = await whichBinary('rg');
    if (found === null && !this.rgMissingWarned) {
      this.logger.warn(
        '`rg` (ripgrep) not found on PATH — fs:grep falling back to pure-Node implementation. Install ripgrep for faster searches.',
      );
      this.rgMissingWarned = true;
    }
    this.rgPath = found;
    return found;
  }

  protected async grepWithRg(
    rgBinary: string,
    cwd: string,
    req: FsGrepRequest,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<FsGrepResponse> {
    const args = ['--json'];
    if (req.context_lines > 0) {
      args.push('--context', String(req.context_lines));
    }
    if (!req.case_sensitive) args.push('--ignore-case');
    if (!req.regex) args.push('--fixed-strings');
    if (req.follow_gitignore) {

      args.push('--no-require-git');
    } else {

      args.push('--no-ignore');
    }
    if (req.include_globs) {
      for (const g of req.include_globs) args.push('--glob', g);
    }
    if (req.exclude_globs) {
      for (const g of req.exclude_globs) args.push('--glob', `!${g}`);
    }
    args.push('--max-count', String(req.max_matches_per_file));
    args.push(req.pattern);
    args.push('.');

    const child = spawn(rgBinary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const fileBuf = new Map<
      string,
      { matches: FsGrepMatch[]; pending: string[]; lastMatchLine: number }
    >();
    const files: FsGrepFileHit[] = [];
    let totalMatches = 0;
    let truncated = false;
    let filesScanned = 0;

    let abortFired = false;
    const onAbort = (): void => {
      if (abortFired) return;
      abortFired = true;
      try {
        child.kill('SIGKILL');
      } catch {

      }
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    let stdoutBuf = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      let nl = stdoutBuf.indexOf('\n');
      while (nl >= 0) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        nl = stdoutBuf.indexOf('\n');
        if (line.length === 0) continue;
        let rec: RgJsonRecord;
        try {
          rec = JSON.parse(line) as RgJsonRecord;
        } catch {
          continue;
        }
        const t = rec.type;
        if (t === 'begin') {
          const p = rgPath(rec.data?.path);
          if (p === undefined) continue;
          if (filesScanned >= req.max_files) {

            truncated = true;
            onAbort();
            return;
          }
          fileBuf.set(p, { matches: [], pending: [], lastMatchLine: -1 });
          filesScanned += 1;
        } else if (t === 'context') {
          const p = rgPath(rec.data?.path);
          if (p === undefined) continue;
          const buf = fileBuf.get(p);
          if (buf === undefined) continue;
          const text = rgText(rec.data?.lines);
          buf.pending.push(stripTrailingNewline(text));

          if (buf.pending.length > req.context_lines * 2) {
            buf.pending.shift();
          }
        } else if (t === 'match') {
          if (totalMatches >= req.max_total_matches) {
            truncated = true;
            onAbort();
            return;
          }
          const p = rgPath(rec.data?.path);
          if (p === undefined) continue;
          const buf = fileBuf.get(p);
          if (buf === undefined) continue;
          if (buf.matches.length >= req.max_matches_per_file) continue;
          const text = stripTrailingNewline(rgText(rec.data?.lines));
          const line = rec.data?.line_number ?? 0;
          const col = (rec.data?.submatches?.[0]?.start ?? 0) + 1;
          const before = buf.pending.slice(-req.context_lines);
          buf.pending.length = 0;
          buf.matches.push({
            line,
            col,
            text,
            before,
            after: [],
          });
          buf.lastMatchLine = line;
          totalMatches += 1;
          if (totalMatches >= req.max_total_matches) {
            truncated = true;
            onAbort();
            return;
          }
        } else if (t === 'end') {
          const p = rgPath(rec.data?.path);
          if (p === undefined) continue;
          const buf = fileBuf.get(p);
          if (buf === undefined) continue;

          if (buf.matches.length > 0 && buf.pending.length > 0) {
            const last = buf.matches.at(-1)!;
            last.after = buf.pending.slice(0, req.context_lines);
          }
          if (buf.matches.length > 0) {
            files.push({ path: p, matches: buf.matches });
          }
          fileBuf.delete(p);
        }
      }
    });

    let stderrBuf = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (c: string) => {
      stderrBuf += c;
    });

    await new Promise<void>((resolve) => {
      child.once('close', () =>{  resolve(); });
      child.once('error', () =>{  resolve(); });
    });

    for (const [p, buf] of fileBuf) {
      if (buf.matches.length > 0 && buf.pending.length > 0) {
        const last = buf.matches.at(-1)!;
        last.after = buf.pending.slice(0, req.context_lines);
      }
      if (buf.matches.length > 0) {
        files.push({ path: p, matches: buf.matches });
      }
    }
    fileBuf.clear();

    if (signal.aborted) {

      if (totalMatches === 0 && filesScanned === 0) {
        throw new FsGrepTimeoutError(Date.now() - startedAt);
      }

      truncated = true;
    }
    void stderrBuf;

    return {
      files,
      files_scanned: filesScanned,
      truncated,
      elapsed_ms: Date.now() - startedAt,
    };
  }

  protected async grepWithNode(
    cwd: string,
    req: FsGrepRequest,
    signal: AbortSignal,
    startedAt: number,
  ): Promise<FsGrepResponse> {
    const matcher = req.follow_gitignore
      ? await this.matcher(cwd)
      : undefined;
    const re = compileGrepPattern(req);

    const files: FsGrepFileHit[] = [];
    let filesScanned = 0;
    let totalMatches = 0;
    let truncated = false;

    const filePaths: string[] = [];
    await this.walk(cwd, '', matcher, async (rel, _name, kind) => {
      if (kind !== 'file') return;
      if (req.include_globs && !matchesAnyGlob(rel, req.include_globs)) {
        return;
      }
      if (req.exclude_globs && matchesAnyGlob(rel, req.exclude_globs)) {
        return;
      }
      filePaths.push(rel);
    });

    for (const rel of filePaths) {
      if (signal.aborted) {
        if (totalMatches === 0 && filesScanned === 0) {
          throw new FsGrepTimeoutError(Date.now() - startedAt);
        }
        truncated = true;
        break;
      }
      if (filesScanned >= req.max_files) {
        truncated = true;
        break;
      }
      filesScanned += 1;
      const abs = path.join(cwd, rel);
      let content: string;
      try {
        content = await fs.readFile(abs, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      const matches: FsGrepMatch[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m === null) continue;
        if (matches.length >= req.max_matches_per_file) break;
        const before: string[] = [];
        for (let k = Math.max(0, i - req.context_lines); k < i; k++) {
          before.push(lines[k] ?? '');
        }
        const after: string[] = [];
        for (
          let k = i + 1;
          k < Math.min(lines.length, i + 1 + req.context_lines);
          k++
        ) {
          after.push(lines[k] ?? '');
        }
        matches.push({
          line: i + 1,
          col: m.index + 1,
          text: line,
          before,
          after,
        });
        totalMatches += 1;
        if (totalMatches >= req.max_total_matches) {
          truncated = true;
          break;
        }
      }
      if (matches.length > 0) {
        files.push({ path: rel, matches });
      }
      if (totalMatches >= req.max_total_matches) break;
    }

    return {
      files,
      files_scanned: filesScanned,
      truncated,
      elapsed_ms: Date.now() - startedAt,
    };
  }

  protected async walk(
    rootAbs: string,
    rootRel: string,
    matcher: Ignore | undefined,
    visit: (
      relPath: string,
      name: string,
      kind: 'file' | 'directory' | 'symlink',
    ) => Promise<void>,
    depth = 0,
  ): Promise<void> {
    if (depth > WALK_MAX_DEPTH) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(
        rootRel === '' ? rootAbs : path.join(rootAbs, ...rootRel.split('/')),
        { withFileTypes: true },
      );
    } catch {
      return;
    }
    for (const d of entries) {
      const name = d.name;

      if (name === '.git') continue;
      const childRel = rootRel === '' ? name : `${rootRel}/${name}`;
      if (matcher) {
        const probe = d.isDirectory() ? `${childRel}/` : childRel;
        if (matcher.ignores(probe)) continue;
      }
      const kind: 'file' | 'directory' | 'symlink' = d.isSymbolicLink()
        ? 'symlink'
        : d.isDirectory()
          ? 'directory'
          : 'file';
      await visit(childRel, name, kind);
      if (d.isDirectory()) {
        await this.walk(rootAbs, childRel, matcher, visit, depth + 1);
      }
    }
  }

  protected async matcher(realCwd: string): Promise<Ignore | undefined> {
    const cached = this.gitignoreCache.get(realCwd);
    if (cached !== undefined) return cached;
    const ig = ignore();
    ig.add('.git/');
    try {
      const contents = await fs.readFile(
        path.join(realCwd, '.gitignore'),
        'utf-8',
      );
      ig.add(contents);
    } catch {

    }
    this.gitignoreCache.set(realCwd, ig);
    return ig;
  }
}

registerSingleton(IFsSearchService, FsSearchService, InstantiationType.Delayed);
