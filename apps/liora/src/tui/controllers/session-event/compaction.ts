import type {
  CompactionCancelledEvent,
  CompactionCompletedEvent,
  CompactionProgressEvent,
  CompactionStartedEvent,
} from '@superliora/sdk';

import type { AppState, QueuedMessage } from '../../types';
import type { TUIState } from '../../tui-state';
import {
  isSameEffectiveModel,
  resolveModelRouteIdentity,
} from '../../utils/model/model-route-notice';
import type { StreamingUIController } from '../streaming-ui/index';

/** Host surface required by compaction event handling. */
export interface CompactionEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  setAppState(patch: Partial<AppState>): void;
  resetLivePane(): void;
  shiftQueuedMessage(): QueuedMessage | undefined;
  takeNextQueuedBatch?(): QueuedMessage | undefined;
}

export class SessionEventCompaction {
  constructor(private readonly host: CompactionEventHost) {}

  handleBegin(event: CompactionStartedEvent): void {
    this.host.streamingUI.finalizeLiveTextBuffers('waiting');
    this.host.setAppState({
      isCompacting: true,
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
    this.host.streamingUI.beginCompaction(event.instruction, {
      modelAlias: event.modelAlias,
    });
    // CompactionComponent already paints the active model on the transcript
    // card — keep a quiet footer pulse only, no transcript notice spam.
    if (event.modelAlias !== undefined && event.modelAlias.length > 0) {
      const parentModel = this.host.state.appState.model;
      const models = this.host.state.appState.availableModels;
      if (
        parentModel.length === 0 ||
        !isSameEffectiveModel(
          resolveModelRouteIdentity(parentModel, models),
          resolveModelRouteIdentity(event.modelAlias, models),
        )
      ) {
        this.host.setAppState({
          lastModelRouteNotice: {
            kind: 'selection',
            fromAlias: parentModel.length > 0 ? parentModel : undefined,
            toAlias: event.modelAlias,
            reason: 'compaction',
            atMs: Date.now(),
          },
        });
      }
    }
  }

  handleEnd(
    event: CompactionCompletedEvent,
    sendQueued: (item: QueuedMessage) => void,
  ): void {
    this.host.streamingUI.endCompaction(event.result.tokensBefore, event.result.tokensAfter);
    this.finish(sendQueued);
  }

  handleCancel(
    _event: CompactionCancelledEvent,
    sendQueued: (item: QueuedMessage) => void,
  ): void {
    this.host.streamingUI.cancelCompaction();
    this.finish(sendQueued);
  }

  handleProgress(event: CompactionProgressEvent): void {
    this.host.streamingUI.updateCompactionProgress(event.phase, event.delta, {
      streamKind: event.streamKind,
      blockIndex: event.blockIndex,
      blockCount: event.blockCount,
      blocksCompleted: event.blocksCompleted,
      fraction: event.fraction,
    });
  }

  private finish(sendQueued: (item: QueuedMessage) => void): void {
    const hasActiveTurn = this.host.streamingUI.hasActiveTurn();
    if (!hasActiveTurn) {
      this.host.setAppState({
        isCompacting: false,
        streamingPhase: 'idle',
      });
      this.host.resetLivePane();
      const next = this.host.takeNextQueuedBatch?.() ?? this.host.shiftQueuedMessage();
      if (next !== undefined) {
        setTimeout(() => {
          sendQueued(next);
        }, 0);
      }
    } else {
      this.host.setAppState({ isCompacting: false });
    }
  }
}
