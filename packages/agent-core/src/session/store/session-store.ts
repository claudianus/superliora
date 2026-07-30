import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'pathe';

import { ErrorCodes, LioraError } from '#/errors/index';
import type { SessionIndexEntry } from '#/session/store/session-index';
import { appendSessionIndexEntry, readSessionIndex } from '#/session/store/session-index';
import { encodeWorkDirKey, normalizeWorkDir } from '#/session/store/workdir-key';
import type { JsonObject, ListSessionsPayload, SessionSummary } from '#/rpc/core-api';
import {
  FORKED_SESSION_DROPPED_FILES,
  SessionSummaryStateSchema,
  appendForkedMarkers,
  assertSafeSessionId,
  compareSessionSummary,
  customMetadataWithoutGoal,
  dropForkedSessionFiles,
  forkCustomMetadata,
  isDirectory,
  isSafeSessionId,
  latestAgentWireMtime,
  metadataFromState,
  normalizeForkTitle,
  normalizeOptionalSessionId,
  normalizeRequiredWorkDir,
  readOptionalState,
  remapSessionPath,
  rewriteAgentHomedirs,
  statIfExists,
  timestampOrFallback,
  titleFromState,
  type SessionSummaryState,
} from '#/session/store/session-store-helpers';

export interface CreateSessionRecordInput {
  readonly id: string;
  readonly workDir: string;
}

export interface ForkSessionRecordInput {
  readonly sourceId: string;
  readonly targetId: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
  /** When set, the forked session is keyed under this workDir (e.g. a new git worktree). */
  readonly workDir?: string;
}

export type SessionStoreOptions = Record<string, never>;

export class SessionStore {
  readonly sessionsDir: string;

  constructor(
    readonly homeDir: string,
    _options: SessionStoreOptions = {},
  ) {
    this.sessionsDir = join(homeDir, 'sessions');
  }

  sessionDirFor(input: { readonly id: string; readonly workDir: string }): string {
    assertSafeSessionId(input.id);
    return join(this.sessionsDir, encodeWorkDirKey(normalizeWorkDir(input.workDir)), input.id);
  }

  async create(input: CreateSessionRecordInput): Promise<SessionSummary> {
    assertSafeSessionId(input.id);
    const workDir = normalizeWorkDir(input.workDir);
    const indexed = await this.findSessionEntry(input.id);
    if (indexed !== undefined) {
      throw new LioraError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.id}" already exists`);
    }

    const dir = this.sessionDirFor({ id: input.id, workDir });
    if (await isDirectory(dir)) {
      throw new LioraError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.id}" already exists`);
    }

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await appendSessionIndexEntry(this.homeDir, {
      sessionId: input.id,
      sessionDir: dir,
      workDir,
    });
    return this.summaryFromDir(input.id, dir, workDir);
  }

  async fork(input: ForkSessionRecordInput): Promise<SessionSummary> {
    const source = await this.findExistingSessionEntry(input.sourceId);
    assertSafeSessionId(input.targetId);
    const indexed = await this.findSessionEntry(input.targetId);
    if (indexed !== undefined) {
      throw new LioraError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.targetId}" already exists`);
    }

    const workDir =
      input.workDir !== undefined ? normalizeWorkDir(input.workDir) : source.workDir;
    const targetDir = this.sessionDirFor({ id: input.targetId, workDir });
    if (await isDirectory(targetDir)) {
      throw new LioraError(ErrorCodes.SESSION_ALREADY_EXISTS, `Session "${input.targetId}" already exists`);
    }

    await mkdir(dirname(targetDir), { recursive: true, mode: 0o700 });
    try {
      await cp(source.sessionDir, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      await dropForkedSessionFiles(targetDir);
      const forkedState = await this.writeForkedState(input, source.sessionDir, workDir, targetDir);
      await appendForkedMarkers(forkedState);
      const summary = await this.summaryFromDir(input.targetId, targetDir, workDir);
      await appendSessionIndexEntry(this.homeDir, {
        sessionId: input.targetId,
        sessionDir: targetDir,
        workDir,
      });
      return summary;
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async get(id: string): Promise<SessionSummary> {
    const entry = await this.findExistingSessionEntry(id);
    return this.summaryFromDir(id, entry.sessionDir, entry.workDir);
  }

  async rename(id: string, title: string): Promise<void> {
    const normalized = title.trim();
    if (normalized.length === 0) {
      throw new LioraError(ErrorCodes.SESSION_TITLE_EMPTY, 'Session title cannot be empty');
    }
    const entry = await this.findExistingSessionEntry(id);
    const statePath = join(entry.sessionDir, 'state.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(statePath, 'utf-8')) as unknown;
    } catch (error) {
      throw new LioraError(ErrorCodes.SESSION_STATE_NOT_FOUND, `Session "${id}" state.json was not found`, {
        cause: error,
      });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new LioraError(ErrorCodes.SESSION_STATE_INVALID, `Session "${id}" state.json is invalid`);
    }
    const next: Record<string, unknown> = {
      ...(parsed as Record<string, unknown>),
      title: normalized,
      isCustomTitle: true,
    };
    await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  }

  async archive(id: string): Promise<SessionSummary> {
    const entry = await this.findExistingSessionEntry(id);
    const statePath = join(entry.sessionDir, 'state.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(statePath, 'utf-8')) as unknown;
    } catch (error) {
      throw new LioraError(ErrorCodes.SESSION_STATE_NOT_FOUND, `Session "${id}" state.json was not found`, {
        cause: error,
      });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new LioraError(ErrorCodes.SESSION_STATE_INVALID, `Session "${id}" state.json is invalid`);
    }
    const now = new Date().toISOString();
    const next: Record<string, unknown> = {
      ...(parsed as Record<string, unknown>),
      archived: true,
      updatedAt: now,
    };
    await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    return this.summaryFromDir(id, entry.sessionDir, entry.workDir);
  }

  async list(options: ListSessionsPayload = {}): Promise<readonly SessionSummary[]> {
    const workDir =
      options.workDir === undefined ? undefined : normalizeRequiredWorkDir(options.workDir);
    const sessionId = normalizeOptionalSessionId(options.sessionId);
    const includeArchive = options.includeArchive === true;

    if (workDir !== undefined) {
      if (sessionId !== undefined) {
        const local = await this.summaryFromWorkDirSession(sessionId, workDir, includeArchive);
        if (local !== undefined) return [local];
        return this.listSessionId(sessionId, includeArchive);
      }
      return this.listWorkDir(workDir, includeArchive);
    }

    if (sessionId !== undefined) {
      return this.listSessionId(sessionId, includeArchive);
    }
    return this.listAll(includeArchive);
  }

  /**
   * Rebuild the global session index from the session directories on disk.
   *
   * The bucket directory name is a one-way hash of the workDir, so the workDir
   * can only be recovered from each session's self-describing `state.json`
   * (`workDir`, falling back to `custom.cwd` for older sessions). Sessions that
   * record no workDir, or whose recorded workDir does not match the bucket they
   * live in, are left untouched rather than writing a misleading entry.
   *
   * The index is append-only and `readSessionIndex` lets later lines override
   * earlier ones for the same id, so appending a corrected line both adds
   * missing entries and repairs stale ones. Best-effort: never throws.
   */
  async reindex(): Promise<{ scanned: number; added: number; repaired: number }> {
    const index = await readSessionIndex(this.homeDir, this.sessionsDir);
    let bucketEntries;
    try {
      bucketEntries = await readdir(this.sessionsDir, { withFileTypes: true });
    } catch {
      return { scanned: 0, added: 0, repaired: 0 };
    }

    let scanned = 0;
    let added = 0;
    let repaired = 0;

    for (const bucket of bucketEntries) {
      if (!bucket.isDirectory()) continue;
      const bucketDir = join(this.sessionsDir, bucket.name);
      let sessionEntries;
      try {
        sessionEntries = await readdir(bucketDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of sessionEntries) {
        if (!entry.isDirectory()) continue;
        const id = entry.name;
        if (!isSafeSessionId(id)) continue;
        const sessionDir = join(bucketDir, id);
        const workDir = await this.recoverWorkDir(sessionDir);
        if (workDir === undefined) continue;
        scanned++;

        let expectedDir: string;
        try {
          expectedDir = this.sessionDirFor({ id, workDir });
        } catch {
          continue;
        }
        // Refuse to index a session whose recorded workDir does not match the
        // bucket it lives in (corrupt or foreign state).
        if (resolve(sessionDir) !== resolve(expectedDir)) continue;

        const existing = index.get(id);
        if (
          existing !== undefined &&
          resolve(existing.sessionDir) === resolve(sessionDir) &&
          existing.workDir === workDir
        ) {
          continue;
        }

        await appendSessionIndexEntry(this.homeDir, { sessionId: id, sessionDir, workDir });
        index.set(id, { sessionId: id, sessionDir, workDir });
        if (existing === undefined) added++;
        else repaired++;
      }
    }
    return { scanned, added, repaired };
  }

  private async recoverWorkDir(sessionDir: string): Promise<string | undefined> {
    const state = await readOptionalState(sessionDir);
    if (state?.workDir !== undefined) {
      try {
        return normalizeWorkDir(state.workDir);
      } catch {
        return undefined;
      }
    }
    const legacyCwd = state?.custom?.['cwd'];
    if (typeof legacyCwd === 'string' && legacyCwd.length > 0) {
      try {
        return normalizeWorkDir(legacyCwd);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async listWorkDir(
    workDir: string,
    includeArchive: boolean,
  ): Promise<readonly SessionSummary[]> {
    const bucketDir = join(this.sessionsDir, encodeWorkDirKey(workDir));
    let entries;
    try {
      entries = await readdir(bucketDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const sessions: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (!isSafeSessionId(id)) continue;
      const dir = join(bucketDir, id);
      const summary = await this.summaryFromDir(id, dir, workDir);
      if (!includeArchive && summary.archived === true) continue;
      sessions.push(summary);
    }
    sessions.sort(compareSessionSummary);
    return sessions;
  }

  private async listSessionId(
    sessionId: string,
    includeArchive: boolean,
  ): Promise<readonly SessionSummary[]> {
    try {
      const summary = await this.get(sessionId);
      if (!includeArchive && summary.archived === true) return [];
      return [summary];
    } catch (error) {
      if (error instanceof LioraError && error.code === ErrorCodes.SESSION_NOT_FOUND) {
        return [];
      }
      throw error;
    }
  }

  private async listAll(includeArchive: boolean): Promise<readonly SessionSummary[]> {
    const index = await readSessionIndex(this.homeDir, this.sessionsDir);
    const sessions: SessionSummary[] = [];
    for (const entry of index.values()) {
      if (!(await isDirectory(entry.sessionDir))) continue;
      const summary = await this.summaryFromDir(entry.sessionId, entry.sessionDir, entry.workDir);
      if (!includeArchive && summary.archived === true) continue;
      sessions.push(summary);
    }
    sessions.sort(compareSessionSummary);
    return sessions;
  }

  private async summaryFromWorkDirSession(
    sessionId: string,
    workDir: string,
    includeArchive: boolean,
  ): Promise<SessionSummary | undefined> {
    if (!isSafeSessionId(sessionId)) return undefined;
    const sessionDir = this.sessionDirFor({ id: sessionId, workDir });
    if (!(await isDirectory(sessionDir))) return undefined;
    const summary = await this.summaryFromDir(sessionId, sessionDir, workDir);
    if (!includeArchive && summary.archived === true) return undefined;
    return summary;
  }

  async assertDirectory(id: string): Promise<string> {
    return (await this.findExistingSessionEntry(id)).sessionDir;
  }

  private async findSessionEntry(id: string): Promise<SessionIndexEntry | undefined> {
    if (!isSafeSessionId(id)) return undefined;
    const index = await readSessionIndex(this.homeDir, this.sessionsDir);
    return index.get(id);
  }

  private async findExistingSessionEntry(id: string): Promise<SessionIndexEntry> {
    const entry = await this.findSessionEntry(id);
    if (entry !== undefined && (await isDirectory(entry.sessionDir))) return entry;
    throw new LioraError(ErrorCodes.SESSION_NOT_FOUND, `Session "${id}" was not found`, {
      details: { sessionId: id },
    });
  }

  private async writeForkedState(
    input: ForkSessionRecordInput,
    sourceDir: string,
    sourceWorkDir: string,
    targetDir: string,
  ): Promise<Record<string, unknown>> {
    const statePath = join(targetDir, 'state.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(statePath, 'utf-8')) as unknown;
    } catch (error) {
      throw new LioraError(
        ErrorCodes.SESSION_STATE_NOT_FOUND,
        `Session "${input.sourceId}" state.json was not found`,
        {
          cause: error,
        },
      );
    }
    if (!isRecord(parsed)) {
      throw new LioraError(
        ErrorCodes.SESSION_STATE_INVALID,
        `Session "${input.sourceId}" state.json is invalid`,
      );
    }

    const title = normalizeForkTitle(input.title, parsed['title']);
    const now = new Date().toISOString();
    const next: Record<string, unknown> = {
      ...parsed,
      createdAt: now,
      updatedAt: now,
      workDir: sourceWorkDir,
      title,
      isCustomTitle: input.title === undefined ? parsed['isCustomTitle'] === true : true,
      forkedFrom: input.sourceId,
      agents: rewriteAgentHomedirs(parsed['agents'], sourceDir, targetDir),
      custom: forkCustomMetadata(parsed['custom'], input.metadata),
    };
    await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    return next;
  }

  private async summaryFromDir(
    id: string,
    sessionDir: string,
    workDir: string,
  ): Promise<SessionSummary> {
    const dirStat = await stat(sessionDir);
    const state = await readOptionalState(sessionDir);
    const [stateInfo, wireInfo, agentsWireMtime] = await Promise.all([
      statIfExists(join(sessionDir, 'state.json')),
      statIfExists(join(sessionDir, 'wire.jsonl')),
      latestAgentWireMtime(sessionDir),
    ]);
    return {
      id,
      workDir: state?.workDir ?? workDir,
      sessionDir,
      createdAt: timestampOrFallback(dirStat.birthtimeMs, dirStat.ctimeMs),
      updatedAt: Math.max(
        dirStat.mtimeMs,
        stateInfo?.mtimeMs ?? 0,
        wireInfo?.mtimeMs ?? 0,
        agentsWireMtime ?? 0,
      ),
      archived: state?.archived === true,
      title: titleFromState(state),
      lastPrompt: state?.lastPrompt,
      metadata: metadataFromState(state),
    };
  }
}
