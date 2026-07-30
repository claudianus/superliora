import type {
  AgentReplayRecord,
  Event,
  PermissionMode,
  ResumedAgentState,
} from '@superliora/sdk';

import {
  isUltraworkTheatreEvent,
  UltraworkTheatreComponent,
  ultraworkTheatreRunId,
} from '../components/messages/ultrawork-theatre';
import {
  createReplayRenderContext,
  limitReplayRecordsByTurn,
  REPLAY_TURN_LIMIT,
  replayEntry,
  type ReplayRenderContext,
} from '../utils/message-replay';
import { buildGoalCompletionMessage } from '../utils/goal-completion';
import { requestTUILayoutRender } from '../utils/frame-render';
import { ttui } from '#/tui/utils/tui-i18n';
import {
  goalLifecycleReplayContent,
  isModelBlockedGoalLifecycle,
  isResumeNormalizationGoalPause,
  yieldToEventLoop,
} from './session-replay-helpers';
import type { SessionReplayMessageRenderer } from './session-replay-message-render';
import type {
  AgentEventReplayRecord,
  ApprovalReplayRecord,
  CompactionReplayRecord,
  GoalReplayLifecycleChange,
  GoalReplayRecord,
  SessionLoadingProgress,
  SessionReplayHost,
} from './session-replay-types';
import type { SessionReplayToolContext } from './session-replay-tool-context';

export class SessionReplayRecordRenderer {
  constructor(
    private readonly host: SessionReplayHost,
    private readonly tools: SessionReplayToolContext,
    private readonly messages: SessionReplayMessageRenderer,
  ) {}

  async renderRecords(
    agent: ResumedAgentState,
    reportLoading: (patch: SessionLoadingProgress) => void,
  ): Promise<void> {
    const context = createReplayRenderContext();
    const records = limitReplayRecordsByTurn(agent.replay, REPLAY_TURN_LIMIT);
    const total = records.length;
    for (let index = 0; index < total; index++) {
      this.renderRecord(context, records[index]!);
      // Yield + progress so the loading modal can paint and the event loop
      // is not starved for the entire synchronous mount of large histories.
      if (total > 0 && (index === 0 || index === total - 1 || (index + 1) % 12 === 0)) {
        const fraction = 0.45 + (0.45 * (index + 1)) / total;
        reportLoading({
          phase: 'building',
          progress: fraction,
          detail: ttui('tui.sessionLoading.progress', {
            current: index + 1,
            total,
          }),
        });
        await yieldToEventLoop();
      }
    }
    this.tools.flushAssistant(context);
    this.tools.cleanupRuntime(context);
  }

  private renderRecord(context: ReplayRenderContext, record: AgentReplayRecord): void {
    switch (record.type) {
      case 'message':
        this.messages.renderMessage(context, record.message);
        return;
      case 'compaction':
        this.renderCompaction(context, record);
        return;
      case 'goal_updated':
        this.renderGoalReplayRecord(context, record);
        return;
      case 'plan_updated':
        this.tools.flushAssistant(context);
        if (!record.enabled && context.suppressNextPlanModeOffNotice) {
          context.suppressNextPlanModeOffNotice = false;
          return;
        }
        context.suppressNextPlanModeOffNotice = false;
        this.host.appendTranscriptEntry(
          replayEntry(context, 'status', `Plan mode: ${record.enabled ? 'ON' : 'OFF'}`, 'notice'),
        );
        return;
      case 'permission_updated':
        this.tools.flushAssistant(context);
        this.renderPermissionUpdate(context, record.mode);
        return;
      case 'approval_result':
        this.tools.flushAssistant(context);
        this.renderApprovalResult(context, record.record);
        return;
      case 'agent_event':
        this.tools.flushAssistant(context);
        this.renderAgentEvent(record.event);
        return;
      case 'config_updated':
        return;
    }
  }

  private renderAgentEvent(event: AgentEventReplayRecord['event']): void {
    const replayEvent = {
      ...event,
      sessionId: this.host.state.appState.sessionId,
      agentId: 'main',
    } as Event;
    if (!isUltraworkTheatreEvent(replayEvent)) return;

    const runId = ultraworkTheatreRunId(replayEvent);
    const existing = this.host.sessionEventHandler.ultraworkTheatres.get(runId);
    if (existing === undefined) {
      const theatre = new UltraworkTheatreComponent(replayEvent);
      this.host.sessionEventHandler.ultraworkTheatres.set(runId, theatre);
      this.host.state.transcriptContainer.addChild(theatre);
    } else {
      existing.applyEvent(replayEvent);
    }
    requestTUILayoutRender(this.host.state);
  }

  private renderCompaction(context: ReplayRenderContext, record: CompactionReplayRecord): void {
    this.tools.flushAssistant(context);
    if (record.result === undefined) return;
    if (record.result === 'cancelled') {
      this.host.appendTranscriptEntry({
        ...replayEntry(context, 'status', 'Compaction cancelled', 'plain'),
        compactionData: {
          result: 'cancelled',
          instruction: record.instruction,
        },
      });
      return;
    }

    this.host.appendTranscriptEntry({
      ...replayEntry(context, 'status', 'Compaction complete', 'plain'),
      compactionData: {
        tokensBefore: record.result.tokensBefore,
        tokensAfter: record.result.tokensAfter,
        instruction: record.instruction,
      },
    });
  }

  private renderGoalReplayRecord(context: ReplayRenderContext, record: GoalReplayRecord): void {
    this.tools.flushAssistant(context);
    const { change } = record;
    switch (change.kind) {
      case 'created':
        this.host.appendTranscriptEntry({
          ...replayEntry(context, 'goal', 'Goal set', 'plain'),
          goalData: { kind: 'created' },
        });
        return;
      case 'completion':
        this.host.appendTranscriptEntry(
          replayEntry(context, 'assistant', buildGoalCompletionMessage(record.snapshot), 'markdown'),
        );
        return;
      case 'lifecycle': {
        const lifecycleChange: GoalReplayLifecycleChange = { ...change, kind: 'lifecycle' };
        if (isResumeNormalizationGoalPause(lifecycleChange)) return;
        if (isModelBlockedGoalLifecycle(lifecycleChange)) {
          return;
        }
        this.appendGoalLifecycleReplayEntry(context, lifecycleChange);
        return;
      }
    }
  }

  private appendGoalLifecycleReplayEntry(
    context: ReplayRenderContext,
    change: GoalReplayLifecycleChange,
  ): void {
    this.host.appendTranscriptEntry({
      ...replayEntry(context, 'goal', goalLifecycleReplayContent(change), 'plain'),
      goalData: { kind: 'lifecycle', change },
    });
  }

  private renderPermissionUpdate(context: ReplayRenderContext, mode: PermissionMode): void {
    if (mode === 'yolo') {
      this.host.appendTranscriptEntry(
        replayEntry(context, 'status', ttui('tui.permission.yolo.on.title'), 'notice', {
          detail: ttui('tui.permission.replay.yoloOn.detail'),
        }),
      );
      return;
    }
    this.host.appendTranscriptEntry(
      replayEntry(
        context,
        'status',
        mode === 'manual' ? ttui('tui.permission.yolo.off.title') : ttui('tui.permission.mode.set', { mode }),
        'notice',
      ),
    );
  }

  private renderApprovalResult(context: ReplayRenderContext, record: ApprovalReplayRecord): void {
    if (record.toolName === 'ExitPlanMode') {
      this.renderPlanReviewResult(context, record);
      return;
    }

    const { result } = record;
    const parts: string[] = [];
    switch (result.decision) {
      case 'approved':
        parts.push(result.scope === 'session' ? 'Approved for session' : 'Approved');
        break;
      case 'rejected':
        parts.push('Rejected');
        break;
      case 'cancelled':
        parts.push('Cancelled');
        break;
    }
    parts.push(`: ${record.action}`);
    if (result.feedback !== undefined && result.feedback.length > 0) {
      parts.push(` — "${result.feedback}"`);
    }
    this.host.appendTranscriptEntry(replayEntry(context, 'status', parts.join(''), 'notice'));
  }

  private renderPlanReviewResult(context: ReplayRenderContext, record: ApprovalReplayRecord): void {
    const { result } = record;
    if (result.decision === 'approved') {
      context.suppressNextPlanModeOffNotice = true;
      return;
    }
    this.tools.removeToolCall(record.toolCallId);

    let content: string;
    switch (result.decision) {
      case 'rejected':
        content =
          result.selectedLabel === 'Revise' ? 'Plan sent back for revision' : 'Plan review rejected';
        break;
      case 'cancelled':
        content = 'Plan review cancelled';
        break;
    }
    const detail =
      result.feedback !== undefined && result.feedback.length > 0
        ? `Feedback: ${result.feedback}`
        : undefined;
    this.host.appendTranscriptEntry(replayEntry(context, 'status', content, 'notice', { detail }));
  }
}
