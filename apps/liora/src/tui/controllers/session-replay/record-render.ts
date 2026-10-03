import type {
  AgentReplayRecord,
  PermissionMode,
  ResumedAgentState,
} from '@superliora/sdk';

import {
  createReplayRenderContext,
  limitReplayRecordsByTurn,
  REPLAY_TURN_LIMIT,
  replayEntry,
  type ReplayRenderContext,
} from '../../utils/session/message-replay';
import { ttui } from '#/tui/utils/tui-i18n';
import { yieldToEventLoop } from './helpers';
import type { SessionReplayMessageRenderer } from './message-render';
import type {
  ApprovalReplayRecord,
  CompactionReplayRecord,
  SessionLoadingProgress,
  SessionReplayHost,
} from './types';
import type { SessionReplayToolContext } from './tool-context';

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
      case 'permission_updated':
        this.tools.flushAssistant(context);
        this.renderPermissionUpdate(context, record.mode);
        return;
      case 'approval_result':
        this.tools.flushAssistant(context);
        this.renderApprovalResult(context, record.record);
        return;
      case 'agent_event':
      case 'config_updated':
        return;
    }
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

}
