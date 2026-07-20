import type { ContentPart, Message } from '@superliora/kosong';

import type { SkillSource } from '../../skill';
import type { BackgroundTaskStatus } from '../background';

export interface UserPromptOrigin {
  readonly kind: 'user';
}

export const USER_PROMPT_ORIGIN: UserPromptOrigin = { kind: 'user' };

export interface SkillActivationOrigin {
  readonly kind: 'skill_activation';
  readonly activationId: string;
  readonly skillName: string;
  readonly skillArgs?: string | undefined;
  readonly trigger: 'user-slash' | 'model-tool' | 'nested-skill';
  readonly skillType?: string | undefined;
  readonly skillPath?: string | undefined;
  readonly skillSource?: SkillSource | undefined;
}

export interface PluginCommandOrigin {
  readonly kind: 'plugin_command';
  readonly activationId: string;
  readonly pluginId: string;
  readonly commandName: string;
  readonly commandArgs?: string | undefined;
  readonly trigger: 'user-slash';
}

export interface InjectionOrigin {
  readonly kind: 'injection';
  readonly variant: string;
}

export interface ShellCommandOrigin {
  readonly kind: 'shell_command';
  readonly phase: 'input' | 'output';
  /** Only present on `phase: 'output'` — whether the command failed, so replay
   *  can colour stderr red only for actual failures (not warnings). */
  readonly isError?: boolean;
}

export interface CompactionSummaryOrigin {
  readonly kind: 'compaction_summary';
}

export interface SystemTriggerOrigin {
  readonly kind: 'system_trigger';
  readonly name: string;
}

export interface BackgroundTaskOrigin {
  readonly kind: 'background_task';
  readonly taskId: string;
  readonly status: BackgroundTaskStatus;
  readonly notificationId: string;
}

export interface CronJobOrigin {
  readonly kind: 'cron_job';
  readonly jobId: string;
  readonly cron: string;
  readonly recurring: boolean;
  /** Number of theoretical fires that were collapsed into this single delivery (>= 1). */
  readonly coalescedCount: number;
  /** True for recurring tasks past the 7-day age threshold. */
  readonly stale: boolean;
}

export interface CronMissedOrigin {
  readonly kind: 'cron_missed';
  /** Number of one-shot tasks bundled into this missed-fire notification. */
  readonly count: number;
}

export interface HookResultOrigin {
  readonly kind: 'hook_result';
  readonly event: string;
  readonly blocked?: boolean;
}

export interface RetryOrigin {
  readonly kind: 'retry';
  readonly trigger?: string;
}

export type PromptOrigin =
  | UserPromptOrigin
  | SkillActivationOrigin
  | PluginCommandOrigin
  | InjectionOrigin
  | ShellCommandOrigin
  | CompactionSummaryOrigin
  | SystemTriggerOrigin
  | BackgroundTaskOrigin
  | CronJobOrigin
  | CronMissedOrigin
  | HookResultOrigin
  | RetryOrigin;

export type UserPromptDisposition = 'keep' | 'drop';

export function userPromptDisposition(origin: PromptOrigin | undefined): UserPromptDisposition {
  if (origin === undefined) return 'keep';
  switch (origin.kind) {
    case 'user':
      return 'keep';
    case 'skill_activation':
      return origin.trigger === 'user-slash' ? 'keep' : 'drop';
    case 'plugin_command':
      return origin.trigger === 'user-slash' ? 'keep' : 'drop';
    case 'injection':
    case 'shell_command':
    case 'compaction_summary':
    case 'system_trigger':
    case 'background_task':
    case 'cron_job':
    case 'cron_missed':
    case 'hook_result':
    case 'retry':
      return 'drop';
    default: {
      const _exhaustive: never = origin;
      void _exhaustive;
      return 'drop';
    }
  }
}

export function isRealUserPromptOrigin(origin: PromptOrigin | undefined): boolean {
  return userPromptDisposition(origin) === 'keep';
}

export type ContextMessage = Message & {
  readonly origin?: PromptOrigin | undefined;
  readonly isError?: boolean;
};

export interface UserMessageRecord {
  content: readonly ContentPart[];
  origin: PromptOrigin;
}

export interface SystemReminderRecord {
  content: string;
  origin: PromptOrigin;
}

/** A single segment in the context composition breakdown. */
export interface ContextCompositionSegment {
  readonly label: string;
  readonly tokens: number;
  readonly children?: readonly ContextCompositionSegment[];
}

/** Full context-window composition breakdown returned by `composition()`. */
export interface ContextComposition {
  readonly totalTokens: number;
  readonly maxContextTokens: number;
  readonly segments: readonly ContextCompositionSegment[];
}

/** Token counts of the variables injected into the system prompt template. */
export interface SystemPromptMeta {
  readonly agentsMdTokens: number;
  readonly cwdListingTokens: number;
  readonly skillsTokens: number;
  readonly additionalDirsTokens: number;
}

export interface AgentContextData {
  history: readonly ContextMessage[];
  tokenCount: number;
  /** Optional Context OS health for /status and harness dashboards. */
  contextOS?: {
    readonly pageCount: number;
    readonly readyPageCount: number;
    readonly needsRehydrationPageCount: number;
    readonly atRiskPageCount: number;
    readonly missingEvidencePageCount: number;
    readonly evidenceIdRecallScore: number;
    readonly latestContinuityStatus: string;
  };
  /** Micro-compaction trigger dashboard (tool-result clearing path). */
  microCompaction?: {
    readonly total: number;
    readonly lastTrigger: string | null;
    readonly lastContextUsageRatio: number | null;
    readonly byTrigger: Readonly<Record<string, number>>;
  };
  autoDream?: {
    readonly enabled: boolean;
    readonly inFlight: boolean;
    readonly runs: number;
    readonly lastDreamAt: number | null;
    readonly lastExamined: number | null;
    readonly lastMerged: number | null;
    readonly minHours: number;
    readonly minActiveRecords: number;
  };
}
