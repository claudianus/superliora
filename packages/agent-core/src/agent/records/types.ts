import type { ContentPart, TokenUsage } from '@superliora/kosong';

import type { LoopRecordedEvent } from '../../loop';
import type { CompactionBeginData, CompactionResult } from '../compaction';
import type { AgentConfigUpdateData } from '../config';
import type { ContextMessage, PromptOrigin } from '../context';
import type { PermissionApprovalResultRecord, PermissionMode } from '../permission';
import type { UsageRecordScope } from '../usage';
import type { TurnCancelSource } from '../../rpc/core-api';
import type { JobLedger } from '../../tools/builtin/job/job-store-key';
import type { JobInbox } from '../../tools/builtin/job/job-inbox';
import type { JobProjectModeState } from '../../tools/builtin/job/job-project-mode';

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

  'usage.record': {
    model: string;
    usage: TokenUsage;
    usageScope?: UsageRecordScope | undefined;
  };

  'full_compaction.cancel': {};
  'full_compaction.complete': {};
  'context.append_message': { message: ContextMessage };
  'context.append_loop_event': { event: LoopRecordedEvent };
  'context.clear': {};
  'context.apply_compaction': CompactionResult;
  'context.undo': { count: number };
  'job.ledger': { ledger: JobLedger };
  'job.inbox': { inbox: JobInbox };
  'job.pool': { pool: JobProjectModeState };

  'subagent.lifecycle': {
    event: SerializableAgentEvent;
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
  /**
   * Synchronously drain every pending record to disk (append + fsync + dir
   * sync). Used only from crash paths (signal handlers,
   * `uncaughtExceptionMonitor`) where no async work can complete before the
   * process dies. Never call this on the hot path — it stalls the event loop.
   */
  flushSync(): void;
  /**
   * Total number of records durably appended to the log so far. This is the
   * append-offset used as the authoritative journal position for checkpoint
   * precedence. Pending (not-yet-fsync'd)
   * records are excluded so the offset only advances once a record is durable.
   */
  recordCount(): number;
}
