/**
 * Request/response shapes for `SDKRpcClientBase` — extracted from rpc.ts.
 *
 * Pure type definitions only; no behavior. Kept as a sibling so rpc.ts can
 * focus on the RPC delegation methods themselves.
 */

import type { PermissionMode, SwarmModeTrigger, TurnCancelSource } from '@superliora/agent-core';

import type { PromptInput } from '#/session/types';

export interface SessionPromptRpcInput {
  readonly sessionId: string;
  readonly input: PromptInput;
}

export interface SessionIdRpcInput {
  readonly sessionId: string;
}

export interface CancelSessionRpcInput extends SessionIdRpcInput {
  readonly source?: TurnCancelSource;
}

export interface ReloadSessionRpcInput extends SessionIdRpcInput {
  readonly forcePluginSessionStartReminder?: boolean;
}

export interface SetSessionModelRpcInput extends SessionIdRpcInput {
  readonly model: string;
}

export interface SetSessionModelRpcResult {
  readonly model: string;
  readonly providerName?: string | undefined;
}

export interface SetSessionThinkingRpcInput extends SessionIdRpcInput {
  readonly level: string;
}

export interface SetSessionPermissionRpcInput extends SessionIdRpcInput {
  readonly mode: PermissionMode;
}

export interface SetSessionPremiumQualityRpcInput extends SessionIdRpcInput {
  readonly enabled: boolean;
}

export interface SetSessionPlanModeRpcInput extends SessionIdRpcInput {
  readonly enabled: boolean;
  readonly ultra?: boolean;
  readonly initialContext?: string;
  readonly source?: 'standalone' | 'ultrawork';
}

export type SetSessionSwarmModeRpcInput =
  | (SessionIdRpcInput & { readonly enabled: true; readonly trigger: SwarmModeTrigger })
  | (SessionIdRpcInput & { readonly enabled: false });

export interface ActivateSkillRpcInput extends SessionIdRpcInput {
  readonly name: string;
  readonly args?: string | undefined;
}

export interface ActivatePluginCommandRpcInput extends SessionIdRpcInput {
  readonly pluginId: string;
  readonly commandName: string;
  readonly args?: string | undefined;
}

export interface SearchSkillsRpcInput extends SessionIdRpcInput {
  readonly query: string;
  readonly limit?: number | undefined;
}

export interface ReconnectMcpServerRpcInput extends SessionIdRpcInput {
  readonly name: string;
}

export interface InlineCompleteRpcInput extends SessionIdRpcInput {
  readonly text: string;
  readonly cursorLine: number;
  readonly cursorCol: number;
  readonly signal?: AbortSignal;
}

export interface SuggestPromptsRpcInput extends SessionIdRpcInput {
  readonly signal?: AbortSignal;
}

/** Shared shape for `startConversationLoop` / `stopConversationLoop` / `listConversationLoops`. */
export interface ConversationLoopState {
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

export interface StartConversationLoopRpcInput extends SessionIdRpcInput {
  readonly prompt: string;
  readonly intervalMs?: number | undefined;
  readonly maxIterations?: number | undefined;
  readonly expiresAt?: number | undefined;
}

export interface StopConversationLoopRpcInput extends SessionIdRpcInput {
  readonly loopId?: string | undefined;
}

export interface RewindFilesRpcInput extends SessionIdRpcInput {
  readonly turnId?: string | undefined;
}

export interface RewindFilesRpcResult {
  readonly turnId: string;
  readonly restored: readonly string[];
  readonly deleted: readonly string[];
  readonly skippedSensitive: readonly string[];
  readonly errors: readonly { path: string; message: string }[];
}

export interface RunShellCommandRpcInput {
  readonly sessionId: string;
  readonly command: string;
  readonly commandId?: string;
}

export interface RunShellCommandRpcResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly isError?: boolean;
  readonly backgrounded?: boolean;
}
