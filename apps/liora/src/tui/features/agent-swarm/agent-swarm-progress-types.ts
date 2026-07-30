import type { AgentSwarmProgressEstimatorPhase } from '#/tui/components/messages/agent-swarm-progress/estimator';
import type { TodoItem } from '#/tui/components/chrome/todo/todo-panel';

export type AgentSwarmPhase = AgentSwarmProgressEstimatorPhase;
export type TotalStatus = 'working' | 'completed' | 'suspended' | 'failed' | 'aborted';

export interface UltraSwarmMemberMetadata {
  readonly expertId: string;
  readonly name: string;
  readonly division?: string;
  readonly emoji?: string;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
  readonly focus?: string;
  readonly dependsOn?: readonly string[];
  readonly taskIds?: readonly string[];
  /** Session agent id when the expert was already spawned at staffing time. */
  readonly agentId?: string;
}

export type SwarmOpsFeedTag =
  | 'staff'
  | 'join'
  | 'live'
  | 'tool'
  | 'pulse'
  | 'done'
  | 'fail'
  | 'wait'
  | 'stop'
  | 'msg'
  | 'mention'
  | 'block'
  | 'standup'
  | 'council';

export interface SwarmCollaborationFeedMessage {
  readonly id?: string;
  readonly from: { readonly expertId?: string; readonly name: string; readonly emoji?: string };
  readonly to?: { readonly expertId: string };
  readonly channel: 'standup' | 'lane' | 'direct' | 'blocker' | 'council';
  readonly body: string;
}

export interface SwarmOpsFeedEntry {
  readonly atMs: number;
  readonly tag: SwarmOpsFeedTag;
  readonly messageId?: string;
  readonly fromExpertId?: string;
  readonly fromName?: string;
  readonly fromEmoji?: string;
  readonly toExpertId?: string;
  /** Humanized (or plain) body shown by default. */
  readonly body: string;
  /** Original protocol/raw body when humanization rewrote the message. */
  readonly rawBody?: string;
}

/** Host-facing action dock request kinds. */
export type AgentSwarmActionDockRequest = 'pause' | 'restaff' | 'raw';

export interface AgentSwarmRestaffRequest {
  readonly reason?: string;
  readonly phase?: string;
}

export interface AgentSwarmPauseRequest {
  readonly reason?: string;
  readonly phase?: string;
}

export type WarRoomDebatePhase = 'critic' | 'rebuttal' | 'counter-critique' | 'consensus' | 'steer';

export interface AgentSwarmMember {
  readonly id: string;
  agentId?: string;
  phase: AgentSwarmPhase;
  ticks: number;
  itemText: string;
  latestModelText: string;
  modelAlias?: string;
  activeToolName?: string;
  ultraSwarm?: UltraSwarmMemberMetadata;
  verdict?: string;
  evidenceIds?: readonly string[];
  completedText?: string;
  failureText?: string;
  cancelledLabelText?: string;
  cancelledLabelColor?: string;
  cancelledMarkColor?: string;
  cancelledBarColor?: string;
  suspendedReason?: string;
  completedAtMs?: number;
  failedAtMs?: number;
  /** First moment the member entered running; drives the per-cell elapsed badge. */
  startedAtMs?: number;
  /** Last moment a Write/Edit tool started in this lane; drives the ✎ code-write pulse. */
  codeWriteAtMs?: number;
  /** Optional dim note after failure text (retry attempt / model fallback). */
  retryNote?: string;
  todos: TodoItem[];
}

export interface AgentSwarmSnapshot {
  readonly phase: AgentSwarmPhase;
  readonly ticks: number;
  readonly latestModelText: string;
  readonly phaseElapsedMs: number;
}

export interface AgentSwarmSummary {
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface AgentSwarmProgressOptions {
  readonly description: string;
  readonly title?: string | undefined;
  readonly requestRender?: () => void;
  readonly availableGridHeight?: () => number | undefined;
  /**
   * Host callback when the war-room action dock requests a pause.
   * Wire to session `pauseUltrawork` / `swarmSteer` as available.
   */
  readonly onRequestPause?: (request: AgentSwarmPauseRequest) => void;
  /**
   * Host callback when the war-room action dock requests restaff.
   * Parent may emit collaboration/steer or invoke UltraSwarm restaff path.
   */
  readonly onRequestRestaff?: (request: AgentSwarmRestaffRequest) => void;
}
