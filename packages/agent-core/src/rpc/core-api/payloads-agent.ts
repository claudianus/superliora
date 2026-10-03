import type { ContentPart } from '@superliora/kosong';

import type { PermissionMode } from '#/agent/permission';

export type TextPromptPart = Extract<ContentPart, { type: 'text' }>;
export type PromptPart = Extract<
  ContentPart,
  { type: 'text' | 'image_url' | 'video_url' | 'audio_url' | 'file_url' }
>;

export type PromptInput = readonly PromptPart[];

export interface PromptPayload {
  readonly input: readonly ContentPart[];
}
export interface RunShellCommandPayload {
  readonly command: string;
  /**
   * TUI-generated correlation id echoed back on every `shell.output` live event
   * so the client can route chunks to the matching entry and drop stale events
   * from a prior run. Optional for callers that don't stream.
   */
  readonly commandId?: string;
}
export interface ShellCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  /** True when the command failed (non-zero exit / timeout / killed) — used by
   *  the TUI to render stderr in red only for actual failures, not warnings. */
  readonly isError?: boolean;
  /** True when the command was detached to the background (ctrl+b) instead of
   *  completing in the foreground. The TUI uses this to skip the normal final
   *  render; the background task stream owns subsequent output. */
  readonly backgrounded?: boolean;
}
export interface CancelShellCommandPayload {
  readonly commandId: string;
}
export interface SteerPayload {
  readonly input: readonly ContentPart[];
}
export type TurnCancelSource =
  | 'esc'
  | 'ctrl-c'
  | 'btw-panel'
  | 'session-close'
  | 'rpc'
  | 'replay';

export interface CancelPayload {
  readonly turnId?: number;
  readonly source?: TurnCancelSource;
}
export interface SetThinkingPayload {
  readonly level: string;
}
export interface SetPermissionPayload {
  readonly mode: PermissionMode;
}
export interface SetModelPayload {
  readonly model: string;
}
export interface SetModelResult {
  readonly model: string;
  readonly providerName?: string | undefined;
}
export interface BeginCompactionPayload {
  readonly instruction?: string;
}
export interface UndoHistoryPayload {
  readonly count: number;
}

export interface StopBackgroundPayload {
  readonly taskId: string;
  /** Free-form human-readable reason persisted with the task record. */
  readonly reason?: string;
}
export interface DetachBackgroundPayload {
  readonly taskId: string;
}
export interface GetBackgroundOutputPayload {
  readonly taskId: string;
  readonly tail?: number;
}
export interface GetBackgroundPayload {
  /**
   * When omitted, returns all tasks (including terminal/lost). Pass
   * `true` to filter down to active-only — useful for model-facing
   * surfaces. UI/TUI consumers should leave it undefined.
   */
  readonly activeOnly?: boolean;
  /** Caps the number of tasks returned. When omitted, returns all matching tasks. */
  readonly limit?: number;
}

