import type { PermissionMode } from '#/agent/permission';
import type { LioraConfig, LioraConfigPatch, McpServerConfig } from '#/config';
import type { ResumeSessionResult } from '#/rpc/resumed';
import type { SessionMeta } from '#/session';

import type { JsonObject } from './core-api-json';

export type { LioraConfig, LioraConfigPatch };

export type EmptyPayload = {};

export type SessionMetadataPatch = Partial<Omit<SessionMeta, 'agents'>>;

export interface ClientTelemetryInfo {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly uiMode?: string | undefined;
}

export interface CreateSessionPayload {
  readonly id?: string | undefined;
  readonly workDir: string;
  readonly model?: string | undefined;
  readonly thinking?: string | undefined;
  readonly permission?: PermissionMode | undefined;
  readonly metadata?: JsonObject | undefined;
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
  readonly additionalDirs?: readonly string[];
  readonly client?: ClientTelemetryInfo | undefined;
  readonly drainAgentTasksOnStop?: boolean;
}

export interface CloseSessionPayload {
  readonly sessionId: string;
}

export interface ArchiveSessionPayload {
  readonly sessionId: string;
}

export interface ResumeSessionPayload {
  readonly sessionId: string;
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
  readonly additionalDirs?: readonly string[];
}

export interface ReloadSessionPayload {
  readonly sessionId: string;
  /**
   * When true, append a fresh `<plugin_session_start>` system reminder to the
   * main agent after the session is reloaded, reflecting the currently enabled
   * plugins. Used by the explicit `/reload` command so the model sees plugin
   * changes without starting a new session. Defaults to false.
   */
  readonly forcePluginSessionStartReminder?: boolean;
}

export interface ForkSessionPayload {
  readonly sessionId: string;
  readonly id?: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
  /**
   * When true, create a git worktree for the forked session and use that path
   * as the new session workDir. Optional `name` becomes the worktree slug.
   */
  readonly worktree?: boolean | { readonly name?: string; readonly baseRef?: string };
}

export interface ShellEnvironment {
  readonly term?: string | undefined;
  readonly termProgram?: string | undefined;
  readonly termProgramVersion?: string | undefined;
  readonly multiplexer?: string | undefined;
  readonly shell?: string | undefined;
}

export interface ExportSessionPayload {
  readonly sessionId: string;
  readonly outputPath?: string | undefined;
  /**
   * When true, the active global diagnostic log (`$SUPER_SUPERLIORA_HOME/logs/super-liora.log`)
   * is copied into the zip at `logs/global/super-liora.log`. Off by default to
   * avoid bundling events from concurrent sessions / other projects.
   */
  readonly includeGlobalLog?: boolean | undefined;
  /** Host version to record in the export manifest. */
  readonly version: string;
  /** How the CLI was installed (e.g. 'npm-global', 'native'). */
  readonly installSource?: string | undefined;
  readonly shellEnv?: ShellEnvironment | undefined;
}

export interface ExportSessionManifest {
  readonly sessionId: string;
  readonly exportedAt: string;
  readonly kimiCodeVersion: string;
  readonly wireProtocolVersion: string;
  readonly os: string;
  readonly nodejsVersion: string;
  readonly sessionFirstActivity?: string | undefined;
  readonly sessionLastActivity?: string | undefined;
  readonly title?: string | undefined;
  readonly workspaceDir?: string | undefined;
  /** zip-relative path to the session diagnostic log when present. */
  readonly sessionLogPath?: string | undefined;
  /** zip-relative path to the bundled global diagnostic log (only when --include-global-log). */
  readonly globalLogPath?: string | undefined;
  /** How the CLI was installed (e.g. 'npm-global', 'native'). */
  readonly installSource?: string | undefined;
  readonly shellEnv?: ShellEnvironment | undefined;
}

export interface ExportSessionResult {
  readonly zipPath: string;
  readonly entries: readonly string[];
  readonly sessionDir: string;
  readonly manifest: ExportSessionManifest;
}

export interface ListSessionsPayload {
  readonly workDir?: string;
  readonly sessionId?: string;
  readonly includeArchive?: boolean;
}

export interface CoreInfo {
  readonly version: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly title?: string | undefined;
  readonly lastPrompt?: string;
  readonly workDir: string;
  readonly sessionDir: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived?: boolean | undefined;
  readonly metadata?: JsonObject | undefined;
  readonly additionalDirs?: readonly string[];
}

export interface RenameSessionPayload {
  readonly title: string;
}

export interface UpdateSessionMetadataPayload {
  readonly metadata: SessionMetadataPatch;
}

export interface AddAdditionalDirPayload {
  readonly path: string;
  readonly persist: boolean;
}

export interface AddAdditionalDirResult {
  readonly additionalDirs: readonly string[];
  readonly projectRoot: string;
  readonly configPath: string;
  readonly persisted: boolean;
}

/** Restore disk files from a sealed turn snapshot (`/rewind`). */
export interface RewindFilesPayload {
  /** Turn id to restore; omit to use the latest sealed turn. */
  readonly turnId?: string | undefined;
}

export interface RewindFilesResult {
  readonly turnId: string;
  readonly restored: readonly string[];
  readonly deleted: readonly string[];
  readonly skippedSensitive: readonly string[];
  readonly errors: readonly { path: string; message: string }[];
}

export interface StartConversationLoopPayload {
  readonly prompt: string;
  readonly intervalMs?: number | undefined;
  readonly maxIterations?: number | undefined;
  readonly expiresAt?: number | undefined;
}

export interface StopConversationLoopPayload {
  readonly loopId?: string | undefined;
}

export interface ConversationLoopStateData {
  readonly id: string;
  readonly prompt: string;
  readonly intervalMs: number;
  readonly maxIterations: number;
  readonly expiresAt?: number | undefined;
  readonly status: 'active' | 'paused' | 'expired' | 'completed' | 'stopped';
  readonly iterations: number;
  readonly createdAt: number;
  readonly lastFiredAt: number | null;
  readonly stopReason?: string | undefined;
}

export type { ResumeSessionResult };
