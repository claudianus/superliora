import {
  FsPathEscapesError,
  FsWatchLimitError,
  SessionNotFoundError,
  resolveSafePath,
  FsWatcherService,
  type ISessionService,
} from '@superliora/agent-core';
import { ErrorCode } from '@superliora/protocol';
import { promises as fspPromises } from 'node:fs';
import { sep as nodePathSep, relative as nodePathRelativeNative } from 'node:path';

export interface FsWatchHandlerResult {
  ok: true;
  watched_paths: string[];
  current_count: number;
}

export interface FsWatchHandlerError {
  ok: false;
  code: number;
  msg: string;
}

export type FsWatchHandlerResponse = FsWatchHandlerResult | FsWatchHandlerError;

export function createFsWatchHandler(deps: {
  sessionService: ISessionService;
  fsWatcher: FsWatcherService;
}) {
  const { sessionService, fsWatcher } = deps;
  return {
    async add(
      sessionId: string,
      connectionId: string,
      wirePaths: readonly string[],
    ): Promise<FsWatchHandlerResponse> {
      try {
        const session = await sessionService.get(sessionId);

        const realCwd = await fspPromises.realpath(session.metadata.cwd);

        fsWatcher.bindSessionCwd(sessionId, realCwd);
        const absPaths: string[] = [];
        for (const p of wirePaths) {
          const safe = await resolveSafePath(session.metadata.cwd, p);
          absPaths.push(safe.absolute);
        }
        fsWatcher.addPaths(sessionId, connectionId, absPaths);
        const watched = fsWatcher.watchedPaths(connectionId, sessionId);

        const wire = watched.map((abs) => toPosixRelativeForCwd(realCwd, abs));
        return {
          ok: true as const,
          watched_paths: wire,
          current_count: fsWatcher.countForConnection(connectionId),
        };
      } catch (error) {
        return mapFsWatchError(error);
      }
    },
    async remove(
      sessionId: string,
      connectionId: string,
      wirePaths: readonly string[],
    ): Promise<FsWatchHandlerResponse> {
      try {
        const session = await sessionService.get(sessionId);
        const realCwd = await fspPromises.realpath(session.metadata.cwd);
        const absPaths: string[] = [];
        for (const p of wirePaths) {
          const safe = await resolveSafePath(session.metadata.cwd, p);
          absPaths.push(safe.absolute);
        }
        fsWatcher.removePaths(sessionId, connectionId, absPaths);
        const watched = fsWatcher.watchedPaths(connectionId, sessionId);
        const wire = watched.map((abs) => toPosixRelativeForCwd(realCwd, abs));
        return {
          ok: true as const,
          watched_paths: wire,
          current_count: fsWatcher.countForConnection(connectionId),
        };
      } catch (error) {
        return mapFsWatchError(error);
      }
    },
    cleanupConnection(connectionId: string) {
      fsWatcher.forgetConnection(connectionId);
    },
  };
}

function toPosixRelativeForCwd(cwd: string, abs: string): string {
  if (abs === cwd) return '.';
  const rel = nodePathRelativeNative(cwd, abs);
  if (rel === '') return '.';
  return rel.split(nodePathSep).join('/');
}

function mapFsWatchError(err: unknown): FsWatchHandlerError {
  if (err instanceof FsWatchLimitError) {
    return {
      ok: false,
      code: ErrorCode.FS_WATCH_LIMIT_EXCEEDED,
      msg: err.message,
    };
  }
  if (err instanceof FsPathEscapesError) {
    return {
      ok: false,
      code: ErrorCode.FS_PATH_ESCAPES_SESSION,
      msg: err.message,
    };
  }
  if (err instanceof SessionNotFoundError) {
    return {
      ok: false,
      code: ErrorCode.SESSION_NOT_FOUND,
      msg: 'session not found',
    };
  }
  return {
    ok: false,
    code: ErrorCode.INTERNAL_ERROR,
    msg: err instanceof Error ? err.message : 'fs watch error',
  };
}
