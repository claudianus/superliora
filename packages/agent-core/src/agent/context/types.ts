import type { ContentPart, Message } from '@superliora/kosong';
import type { BackgroundTaskStatus } from '../background';

export interface UserPromptOrigin { readonly kind: 'user' }
export const USER_PROMPT_ORIGIN: UserPromptOrigin = { kind: 'user' };
export interface ShellCommandOrigin { readonly kind: 'shell_command'; readonly phase: 'input' | 'output'; readonly isError?: boolean }
export interface CompactionSummaryOrigin { readonly kind: 'compaction_summary' }
export interface SystemTriggerOrigin { readonly kind: 'system_trigger'; readonly name: string }
interface BackgroundTaskOrigin { readonly kind: 'background_task'; readonly taskId: string; readonly status: BackgroundTaskStatus; readonly notificationId: string }
export interface RetryOrigin { readonly kind: 'retry'; readonly trigger?: string }
export type PromptOrigin = UserPromptOrigin | ShellCommandOrigin | CompactionSummaryOrigin | SystemTriggerOrigin | BackgroundTaskOrigin | RetryOrigin;
export type UserPromptDisposition = 'keep' | 'drop';

export function userPromptDisposition(origin: PromptOrigin | undefined): UserPromptDisposition {
  return origin === undefined || origin.kind === 'user' ? 'keep' : 'drop';
}

export function isRealUserPromptOrigin(origin: PromptOrigin | undefined): boolean {
  return origin === undefined || origin.kind === 'user';
}

export type ContextMessage = Message & { readonly origin?: PromptOrigin; readonly isError?: boolean };
export interface UserMessageRecord { readonly content: readonly ContentPart[]; readonly origin: PromptOrigin }
export interface SystemReminderRecord { readonly content: string; readonly origin: PromptOrigin }
export interface ContextCompositionSegment { readonly label: string; readonly tokens: number; readonly children?: readonly ContextCompositionSegment[] }
export interface ContextComposition { readonly totalTokens: number; readonly maxContextTokens: number; readonly segments: readonly ContextCompositionSegment[] }
export interface SystemPromptMeta { readonly agentsMdTokens: number; readonly cwdListingTokens: number; readonly additionalDirsTokens: number }
export interface AgentContextData { readonly history: readonly ContextMessage[]; readonly tokenCount: number }
