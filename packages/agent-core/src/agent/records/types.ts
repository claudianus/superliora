import type { ContentPart, TokenUsage } from '@superliora/kosong';

import type { UltraworkRun } from '@superliora/protocol';

import type { LoopRecordedEvent } from '../../loop';
import type { GoalActor, GoalBudgetLimits, GoalStatus } from '../goal';
import type { ToolStoreUpdate } from '../../tools/store';
import type { CompactionBeginData, CompactionResult } from '../compaction';
import type { AgentConfigUpdateData } from '../config';
import type { ContextMessage, PromptOrigin } from '../context';
import type { PermissionApprovalResultRecord, PermissionMode } from '../permission';
import type { UserToolRegistration } from '../tool';
import type { UsageRecordScope } from '../usage';
import type { SwarmModeTrigger } from '../swarm';
import type { TurnCancelSource } from '../../rpc/core-api';

export interface SerializableAgentEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

// Agent records are the ordered event log used to rebuild agent state on resume.
// Use records, not state.json, when correctness depends on the order in which
// state transitions happened. Each persisted record type must have explicit
// resume semantics in restoreAgentRecord; a write-only record is not persistence.
export interface AgentRecordEvents {
  metadata: {
    protocol_version: string;
    created_at: number;
  };

  forked: {};

  'turn.prompt': {
    input: readonly ContentPart[];
    origin: PromptOrigin;
  };
  'turn.steer': {
    input: readonly ContentPart[];
    origin: PromptOrigin;
  };
  'turn.cancel': { turnId?: number; source?: TurnCancelSource };

  'config.update': AgentConfigUpdateData;

  'permission.set_mode': {
    mode: PermissionMode;
  };
  'permission.record_approval_result': PermissionApprovalResultRecord;

  'full_compaction.begin': CompactionBeginData;

  'plan_mode.enter': {
    id: string;
    ultra?: boolean;
  };
  'plan_mode.cancel': {
    id?: string;
  };
  'plan_mode.exit': {
    id?: string;
  };
  'ultra_swarm_engage_gate.set': {
    planPath?: string;
    reason?: string;
  };
  'ultra_swarm_engage_gate.clear': {
    reason?: string;
  };

  'swarm_mode.enter': {
    trigger: SwarmModeTrigger;
  };
  'swarm_mode.exit': {};

  'tools.register_user_tool': UserToolRegistration;
  'tools.unregister_user_tool': {
    name: string;
  };
  'tools.set_active_tools': {
    names: readonly string[];
  };

  'usage.record': {
    model: string;
    usage: TokenUsage;
    usageScope?: UsageRecordScope | undefined;
  };

  'full_compaction.cancel': {};
  'full_compaction.complete': {};
  'micro_compaction.apply': { cutoff: number };

  'context.append_message': { message: ContextMessage };
  'context.append_loop_event': { event: LoopRecordedEvent };
  'context.clear': {};
  'context.apply_compaction': CompactionResult;
  'context.undo': { count: number };

  'tools.update_store': ToolStoreUpdate;

  'goal.create': {
    goalId: string;
    objective: string;
    completionCriterion?: string;
  };
  'goal.update': {
    status?: GoalStatus;
    tokensUsed?: number;
    turnsUsed?: number;
    wallClockMs?: number;
    budgetLimits?: GoalBudgetLimits;
    reason?: string;
    actor?: GoalActor;
  };
  'goal.clear': {};

  'subagent.lifecycle': {
    event: SerializableAgentEvent;
  };
  'ultrawork.event': {
    event: SerializableAgentEvent;
  };
  'ultrawork.run': {
    run: UltraworkRun;
    activation?: {
      source: 'manual' | 'auto' | 'shift-tab' | 'goal' | 'headless';
      replaceGoal: boolean;
      evidenceRoot: string;
      workDir: string;
    };
    interruptReason?: string;
  };
  'ultrawork.mode': {
    enabled: boolean;
  };
}

export type AgentRecord = {
  [K in keyof AgentRecordEvents]: Readonly<AgentRecordEvents[K]> & {
    readonly type: K;
    readonly time?: number;
  };
}[keyof AgentRecordEvents];

export type AgentRecordOf<K extends keyof AgentRecordEvents> = Extract<
  AgentRecord,
  { readonly type: K }
>;

export interface AgentRecordPersistence {
  read(): AsyncIterable<AgentRecord>;
  append(input: AgentRecord): void;
  rewrite(records: readonly AgentRecord[]): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}
