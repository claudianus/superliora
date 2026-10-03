import type {
  AgentStatusUpdatedEvent,
  ErrorEvent,
  SessionMetaUpdatedEvent,
  WarningEvent,
} from '@superliora/sdk';

import {
  OAUTH_LOGIN_REQUIRED_CODE,
  OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE,
} from '../../constant/liora-tui';
import { errorReportHintLine } from '../../constant/feedback';
import type { AppState, TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import type { ColorToken } from '#/tui/theme';
import { computeSessionCostUsd } from '#/tui/utils/session/session-cost';
import { cacheMeterFromHitRate } from '#/tui/utils/cache/cache-glance';
import {
  formatErrorPayload,
  stringValue,
} from '../../utils/event-payload';
import { ttui } from '../../utils/tui-i18n';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import { notifyError } from '../../utils/notification/desktop-notification';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by session notice / transcript side-effect handlers. */
export interface NoticeEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  setAppState(patch: Partial<AppState>): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  updateTerminalTitle(): void;
  setLastTurnFailed(failed: boolean): void;
}

export class SessionEventNotices {
  constructor(private readonly host: NoticeEventHost) {}

  handleStatusUpdate(event: AgentStatusUpdatedEvent): void {
    const patch: Partial<AppState> = {};
    if (event.contextUsage !== undefined) patch.contextUsage = event.contextUsage;
    if (event.contextTokens !== undefined) patch.contextTokens = event.contextTokens;
    if (event.maxContextTokens !== undefined) patch.maxContextTokens = event.maxContextTokens;
    if (event.usage?.total !== undefined) {
      const modelId = event.model ?? this.host.state.appState.model;
      const pricing = this.host.state.appState.availableModels[modelId]?.cost;
      const costUsd = computeSessionCostUsd(event.usage.total, pricing);
      if (costUsd !== undefined) patch.sessionCostUsd = costUsd;
    }
    const cacheMeter = cacheMeterFromHitRate(
      event.usage?.cacheHitRate,
      event.usage?.cacheWarmStreak,
    );
    if (cacheMeter !== undefined) patch.cacheMeter = cacheMeter;
    if (event.permission !== undefined) {
      patch.permissionMode = event.permission;
    }
    if (event.model !== undefined) patch.model = event.model;
    if ('providerRoute' in event) patch.providerRouteStatus = event.providerRoute ?? null;
    if (Object.keys(patch).length > 0) this.host.setAppState(patch);
  }

  handleSessionMetaChanged(event: SessionMetaUpdatedEvent): void {
    const title = event.title ?? stringValue(event.patch?.['title']);
    if (title !== undefined) {
      this.host.setAppState({ sessionTitle: title });
      this.host.updateTerminalTitle();
    }
  }

  handleSessionError(event: ErrorEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('idle');
    // Desktop notification on error (honors [notifications] preference).
    notifyError(
      event.message ?? ttui('tui.notices.sessionError'),
      this.host.state,
      { key: `error:${event.code}:${this.host.state.appState.sessionId}` },
    );
    // Mark the last turn as failed so the user can re-send it with Hub Retry
    // or `/retry`.
    this.host.setLastTurnFailed(true);
    if (event.code === OAUTH_LOGIN_REQUIRED_CODE) {
      this.host.showError(OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE());
      return;
    }
    this.host.showError(formatErrorPayload(event));
    const sessionId = this.host.state.appState.sessionId;
    if (sessionId.length > 0) {
      this.host.showStatus(errorReportHintLine());
      this.host.appendTranscriptEntry({
        id: `retry-hint-${Date.now()}`,
        kind: 'status',
        turnId: undefined,
        renderMode: 'plain',
        content: ttui('tui.retry.hint'),
        color: 'warning',
        bullet: '',
      });
    }
  }

  handleSessionWarning(event: WarningEvent): void {
    this.host.showStatus(ttui('tui.notice.warningPrefix', { message: event.message }), 'warning');
  }

}
