import type { PromptPart, Session } from '@superliora/sdk';

import type { AppState, LivePaneState } from '../../types';
import type { MessageDispatchController } from '../transcript/message-dispatch';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by session request / queue orchestration. */
export interface SessionRequestsHost {
  readonly streamingUI: StreamingUIController;
  readonly messageDispatch: MessageDispatchController;

  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  showError(msg: string): void;
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

  steerMessage(
    session: Session,
    input: string[],
    options?: {
      readonly parts?: readonly PromptPart[];
      readonly imageAttachmentIds?: readonly number[];
    },
  ): void {
    this.host.messageDispatch.steerMessage(session, input, options);
  }
}
