import type { AgentType } from '#/agent';
import type { BackgroundTaskInfo } from '#/agent/background';
import type { CompactionResult } from '#/agent/compaction';
import type { AgentConfigData, AgentConfigUpdateData } from '#/agent/config';
import type { AgentContextData, ContextMessage } from '#/agent/context';
import type {
  PermissionApprovalResultRecord,
  PermissionData,
  PermissionMode,
} from '#/agent/permission';
import type { SessionSummary } from '#/rpc/core-api';
import type { AgentEvent, UsageStatus } from '#/rpc/events';
import type { SessionMeta } from '#/session';

export type AgentReplayRecordPayload =
  | { type: 'message'; message: ContextMessage }
  | { type: 'compaction'; result?: CompactionResult | 'cancelled'; instruction?: string }
  | { type: 'config_updated'; config: AgentConfigUpdateData }
  | { type: 'permission_updated'; mode: PermissionMode }
  | { type: 'approval_result'; record: PermissionApprovalResultRecord }
  | { type: 'agent_event'; event: AgentEvent };

export type AgentReplayRecord = { readonly time: number } & AgentReplayRecordPayload;

export interface ResumedAgentState {
  readonly type: AgentType;
  readonly config: AgentConfigData;
  readonly context: AgentContextData;
  readonly replay: readonly AgentReplayRecord[];
  readonly permission: PermissionData;
  readonly usage: UsageStatus;
  readonly background: readonly BackgroundTaskInfo[];
}

export interface ResumeSessionResult extends SessionSummary {
  readonly sessionMetadata: SessionMeta;
  readonly agents: Readonly<Record<string, ResumedAgentState>>;
  readonly additionalDirs: readonly string[];
  readonly warning?: string | undefined;
}
