import type { ContentPart } from '@superliora/kosong';

import type { PermissionMode } from '#/agent/permission';
import type { SwarmModeTrigger } from '#/agent/swarm';

export type TextPromptPart = Extract<ContentPart, { type: 'text' }>;
export type PromptPart = Extract<ContentPart, { type: 'text' | 'image_url' | 'video_url' }>;

export type PromptInput = readonly PromptPart[];

export interface DiagnoseContextOSPayload {
  readonly query?: string;
  readonly limit?: number;
}

export interface EnterPlanPayload {
  readonly ultra?: boolean;
  readonly initialContext?: string;
  readonly source?: 'standalone' | 'ultrawork';
}

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
   *  render (the backgrounding path owns the UI + model notification). */
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
  | 'goal-command'
  | 'btw-panel'
  | 'session-close'
  | 'rpc'
  | 'replay';

export interface CancelPayload {
  readonly turnId?: number;
  readonly source?: TurnCancelSource;
}
export interface SetPremiumQualityPayload {
  readonly enabled: boolean;
}
export interface SetOrchestratorModePayload {
  readonly enabled: boolean;
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
export interface CancelPlanPayload {
  readonly id?: string;
}
export interface EnterSwarmPayload {
  readonly trigger: SwarmModeTrigger;
}
export interface BeginCompactionPayload {
  readonly instruction?: string;
}
export interface UndoHistoryPayload {
  readonly count: number;
}

export interface RegisterToolPayload {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}
export interface UnregisterToolPayload {
  readonly name: string;
}
export interface SetActiveToolsPayload {
  readonly names: readonly string[];
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
export interface InlineCompletePayload {
  /** Full text currently in the prompt editor. */
  readonly text: string;
  readonly cursorLine: number;
  readonly cursorCol: number;
}
export interface InlineCompleteResult {
  /** Predicted continuation to render as ghost text after the cursor (may be empty). */
  readonly completion: string;
  /** Effective model alias used for this prediction (completion/cheap/main). */
  readonly modelAlias?: string;
}
export interface SuggestPromptsResult {
  /** Contextually relevant next-task prompts (may be empty). */
  readonly suggestions: readonly string[];
  /** Effective model alias used for this suggestion call. */
  readonly modelAlias?: string;
}
/**
 * Optional out-of-band call options for prompt-intelligence RPCs. The abort
 * {@link signal} is threaded through the in-process RPC boundary so a stale
 * in-flight completion can be cancelled server-side when the user keeps typing.
 */
export interface PromptIntelligenceCallOptions {
  readonly signal?: AbortSignal;
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

export interface CreateGoalPayload {
  readonly objective: string;
  readonly replace?: boolean;
  readonly source?: 'standalone' | 'ultrawork';
}
