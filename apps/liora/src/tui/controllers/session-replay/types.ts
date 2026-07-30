import type {
  AgentReplayRecord,
  GoalChange,
  Session,
} from '@superliora/sdk';

import type { AppState, TranscriptEntry } from '../../types';
import type { StreamingUIController } from '../streaming-ui/index';
import type { SessionEventHandler } from '../session-event/handler';
import type { TUIState } from '../../tui-state';
import type { MotionBeatController } from '#/tui/utils/render/motion-beats';

export type GoalReplayRecord = Extract<AgentReplayRecord, { type: 'goal_updated' }>;
export type CompactionReplayRecord = Extract<AgentReplayRecord, { type: 'compaction' }>;
export type AgentEventReplayRecord = Extract<AgentReplayRecord, { type: 'agent_event' }>;
export type GoalReplayLifecycleChange = GoalChange & { readonly kind: 'lifecycle' };

export interface SessionLoadingProgress {
  readonly phase?: 'opening' | 'loading' | 'building' | 'finishing' | 'ready';
  readonly progress?: number;
  readonly detail?: string;
  readonly sessionId?: string;
  readonly title?: string;
}

export interface SessionReplayHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  readonly sessionEventHandler: SessionEventHandler;
  readonly motionBeats: MotionBeatController;
  setAppState(patch: Partial<AppState>): void;
  showError(msg: string): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  mergeAllTurnSteps(): void;
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;
  requireSession(): Session;
  showStatus(msg: string, severity?: 'info' | 'warning' | 'error'): void;
  /** True while the session-loading editor modal is mounted. */
  isSessionLoadingOverlayActive(): boolean;
  beginSessionLoading(sessionId?: string): void;
  reportSessionLoading(patch: SessionLoadingProgress): void;
  endSessionLoading(): void;
}

export type ApprovalReplayRecord = Extract<
  AgentReplayRecord,
  { type: 'approval_result' }
>['record'];
