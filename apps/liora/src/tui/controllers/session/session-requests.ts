import type { Session } from '@superliora/sdk';

import type { AppState, LivePaneState } from '../../types';
import { formatErrorMessage } from '../../utils/event-payload';
import type { MessageDispatchController } from '../transcript/message-dispatch';
import type { SessionEventHandler } from '../session-event/handler';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by session request / queue orchestration. */
export interface SessionRequestsHost {
  readonly streamingUI: StreamingUIController;
  readonly messageDispatch: MessageDispatchController;
  readonly sessionEventHandler: SessionEventHandler;

  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  showError(msg: string): void;
  sendQueuedMessage(session: Session, item: import('../types').QueuedMessage): void;
}

/**
 * Session request lifecycle (begin/fail) and queued message dispatch helpers.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class SessionRequestsController {
  constructor(private readonly host: SessionRequestsHost) {}

  beginSessionRequest(): void {
    const { host } = this;
    host.streamingUI.setTurnId(undefined);
    host.streamingUI.resetLiveText();
    host.streamingUI.resetToolUi();
    host.streamingUI.resetToolCallState();

    host.patchLivePane({
      mode: 'waiting',
      pendingApproval: null,
      pendingQuestion: null,
    });
    host.setAppState({
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
  }

  failSessionRequest(message: string): void {
    const { host } = this;
    host.setAppState({ streamingPhase: 'idle' });
    host.resetLivePane();
    host.showError(message);
  }

  requestQueuedGoalPromotion(): void {
    this.host.sessionEventHandler.requestQueuedGoalPromotion();
  }

  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void {
    this.host.messageDispatch.sendSkillActivation(session, skillName, skillArgs);
  }

  activatePluginCommand(
    session: Session,
    pluginId: string,
    commandName: string,
    args: string,
  ): void {
    const { host } = this;
    this.beginSessionRequest();
    void session.activatePluginCommand(pluginId, commandName, args).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.failSessionRequest(`Command "${pluginId}:${commandName}" failed: ${message}`);
    });
  }

  steerMessage(session: Session, input: string[]): void {
    this.host.messageDispatch.steerMessage(session, input);
  }
}
