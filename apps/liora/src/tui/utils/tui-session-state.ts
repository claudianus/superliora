/**
 * Durable, session-scoped UI preferences.
 *
 * This intentionally contains only UI state that remains meaningful after
 * replay. Agent/runtime state belongs to the session records and global
 * appearance belongs to tui.toml.
 */

import { z } from 'zod';

import { readJsonFile, writeJsonFile } from '#/utils/persistence';

import {
  TOOL_OUTPUT_VIEWPORT_MAX_HEIGHT,
  TOOL_OUTPUT_VIEWPORT_MIN_HEIGHT,
  createToolOutputViewportState,
  type ToolOutputViewportState,
} from './tool/tool-output-viewport';
import type { TranscriptDetailLevel, TranscriptEntry } from '../types';

export const TUI_SESSION_STATE_FILE = 'tui-session.json';
export const TUI_SESSION_STATE_VERSION = 1 as const;

const MAX_VIEWPORT_ENTRIES = 200;
const MAX_TOOL_CALL_ID_LENGTH = 300;

const transcriptDetailSchema = z.enum(['minimal', 'compact', 'standard', 'full']);
const stageSizeSchema = z.object({
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
const viewportSchema = z.object({
  height: z.number().int().min(1),
});
const fileSchema = z.object({
  version: z.literal(TUI_SESSION_STATE_VERSION),
  updatedAt: z.string(),
  transcriptDetail: transcriptDetailSchema.optional(),
  userStageSize: stageSizeSchema.optional(),
  toolOutputViewports: z.record(z.string().max(MAX_TOOL_CALL_ID_LENGTH), viewportSchema).optional(),
  sessionsScope: z.enum(['cwd', 'all']).optional(),
});

export type TuiSessionStateSnapshot = z.infer<typeof fileSchema>;

export interface TuiSessionStateSession {
  readonly summary?: {
    readonly sessionDir?: string;
  };
}

export interface TuiSessionStateHost {
  readonly session: TuiSessionStateSession | undefined;
  readonly state: {
    transcriptDetail: TranscriptDetailLevel;
    toolOutputViewports: Map<string, ToolOutputViewportState>;
    sessionsScope: 'cwd' | 'all';
    userStageSize?: { width: number; height: number };
    terminal: { readonly columns: number; readonly rows: number };
    transcriptEntries: readonly TranscriptEntry[];
  };
  setTranscriptDetail?(level: TranscriptDetailLevel): void;
}

const writeLocks = new Map<string, Promise<void>>();

export function tuiSessionStatePath(session: TuiSessionStateSession): string | undefined {
  const sessionDir = session.summary?.sessionDir?.trim();
  if (sessionDir === undefined || sessionDir.length === 0) return undefined;
  return `${sessionDir.replace(/\/+$/, '')}/${TUI_SESSION_STATE_FILE}`;
}

export async function readTuiSessionState(
  session: TuiSessionStateSession,
): Promise<TuiSessionStateSnapshot> {
  const filePath = tuiSessionStatePath(session);
  if (filePath === undefined) return emptySnapshot();
  try {
    return await readJsonFile(filePath, fileSchema, emptySnapshot());
  } catch {
    return emptySnapshot();
  }
}

export async function restoreTuiSessionState(host: TuiSessionStateHost): Promise<void> {
  const session = host.session;
  if (session === undefined) return;

  const snapshot = await readTuiSessionState(session);
  if (snapshot.transcriptDetail !== undefined) {
    if (host.setTranscriptDetail !== undefined) {
      host.setTranscriptDetail(snapshot.transcriptDetail);
    } else {
      host.state.transcriptDetail = snapshot.transcriptDetail;
    }
  }
  if (snapshot.userStageSize !== undefined) {
    host.state.userStageSize = clampStageSize(
      snapshot.userStageSize,
      host.state.terminal.columns,
      host.state.terminal.rows,
    );
  }
  if (snapshot.toolOutputViewports !== undefined) {
    host.state.toolOutputViewports.clear();
    for (const [toolCallId, viewport] of Object.entries(snapshot.toolOutputViewports)) {
      host.state.toolOutputViewports.set(
        toolCallId,
        createToolOutputViewportState({
          height: clampViewportHeight(viewport.height),
        }),
      );
    }
  }
  if (snapshot.sessionsScope !== undefined) {
    host.state.sessionsScope = snapshot.sessionsScope;
  }
}

export async function writeTuiSessionState(host: TuiSessionStateHost): Promise<void> {
  const session = host.session;
  if (session === undefined) return;
  const filePath = tuiSessionStatePath(session);
  if (filePath === undefined) return;

  const snapshot = captureTuiSessionState(host);
  await withWriteLock(filePath, () => writeJsonFile(filePath, fileSchema, snapshot));
}

/** Immediate best-effort write for UI gestures and picker changes. */
export function persistTuiSessionState(host: TuiSessionStateHost): void {
  if (host.session === undefined || tuiSessionStatePath(host.session) === undefined) return;
  void writeTuiSessionState(host).catch(() => {
    // A UI preference must never make the interactive path fail.
  });
}

export function captureTuiSessionState(host: TuiSessionStateHost): TuiSessionStateSnapshot {
  const viewports: Record<string, { height: number }> = {};
  for (const [toolCallId, viewport] of [...host.state.toolOutputViewports].slice(0, MAX_VIEWPORT_ENTRIES)) {
    const normalizedId = toolCallId.slice(0, MAX_TOOL_CALL_ID_LENGTH);
    if (normalizedId.length === 0) continue;
    viewports[normalizedId] = { height: clampViewportHeight(viewport.height) };
  }

  return {
    version: TUI_SESSION_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    transcriptDetail: host.state.transcriptDetail,
    ...(host.state.userStageSize !== undefined
      ? {
          userStageSize: clampStageSize(
            host.state.userStageSize,
            host.state.terminal.columns,
            host.state.terminal.rows,
          ),
        }
      : {}),
    ...(Object.keys(viewports).length > 0 ? { toolOutputViewports: viewports } : {}),
    sessionsScope: host.state.sessionsScope,
  };
}

/**
 * Replay may leave sidecar entries for tools that no longer exist in the
 * retained history. Remove those entries before the next write.
 */
export function pruneTuiSessionToolOutputViewports(host: TuiSessionStateHost): void {
  const activeIds = new Set<string>();
  for (const entry of host.state.transcriptEntries as readonly TranscriptEntry[]) {
    const toolCall = entry.toolCallData;
    if (toolCall !== undefined) {
      activeIds.add(toolCall.id);
      for (const nested of toolCall.subagent?.toolCalls ?? []) activeIds.add(nested.id);
    }
  }
  for (const toolCallId of host.state.toolOutputViewports.keys()) {
    if (!activeIds.has(toolCallId)) host.state.toolOutputViewports.delete(toolCallId);
  }
}

function clampStageSize(
  size: { readonly width: number; readonly height: number },
  terminalWidth: number,
  terminalHeight: number,
): { width: number; height: number } {
  return {
    width: clampDimension(size.width, terminalWidth),
    height: clampDimension(size.height, terminalHeight),
  };
}

function clampDimension(value: number, terminalSize: number): number {
  const max = Number.isFinite(terminalSize) && terminalSize > 0 ? Math.floor(terminalSize) : Math.floor(value);
  return Math.min(Math.max(1, Math.floor(value)), Math.max(1, max));
}

function clampViewportHeight(value: number): number {
  return Math.min(
    TOOL_OUTPUT_VIEWPORT_MAX_HEIGHT,
    Math.max(TOOL_OUTPUT_VIEWPORT_MIN_HEIGHT, Math.floor(value)),
  );
}

function emptySnapshot(): TuiSessionStateSnapshot {
  return {
    version: TUI_SESSION_STATE_VERSION,
    updatedAt: new Date(0).toISOString(),
    sessionsScope: 'cwd',
  };
}

async function withWriteLock(filePath: string, work: () => Promise<void>): Promise<void> {
  const previous = writeLocks.get(filePath) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  const lock = run.then(
    () => undefined,
    () => undefined,
  );
  writeLocks.set(filePath, lock);
  try {
    await run;
  } finally {
    if (writeLocks.get(filePath) === lock) writeLocks.delete(filePath);
  }
}
