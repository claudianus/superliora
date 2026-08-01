import type {
  CompactionBlockedEvent,
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
}

export class SessionEventCompaction {
  constructor(private readonly host: CompactionEventHost) {}

  handleBegin(event: CompactionStartedEvent): void {
    const background = event.mode === 'background';
    if (background) {
      // Async pre-rot: keep the live turn interactive; only surface a badge.
      // Do not flush live thinking/assistant buffers mid-turn.
      this.host.setAppState({ isBackgroundCompacting: true });
    } else {
      this.host.streamingUI.finalizeLiveTextBuffers('waiting');
      this.host.setAppState({
        isCompacting: true,
        isBackgroundCompacting: false,
        streamingPhase: 'waiting',
        streamingStartTime: Date.now(),
      });
    }
    this.host.streamingUI.beginCompaction(event.instruction, {
      background,
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
            reason: background ? 'compaction-background' : 'compaction',
            atMs: Date.now(),
          },
        });
      }
    }
  }

  handleBlocked(_event: CompactionBlockedEvent): void {
    // Background pre-rot has been awaited by the turn: promote to blocking UX.
    if (!this.host.state.appState.isBackgroundCompacting && !this.host.state.appState.isCompacting) {
      return;
    }
    this.host.streamingUI.finalizeLiveTextBuffers('waiting');
    this.host.setAppState({
      isCompacting: true,
      isBackgroundCompacting: false,
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
    this.host.streamingUI.promoteCompactionToBlocking();
  }

  handleEnd(
    event: CompactionCompletedEvent,
    sendQueued: (item: QueuedMessage) => void,
  ): void {
    const swarmDetail = event.result.summary.includes('swarm_runs:')
      ? 'Swarm coordination state preserved in structured memory'
      : undefined;
    this.host.streamingUI.endCompaction(
      event.result.tokensBefore,
      event.result.tokensAfter,
      swarmDetail,
    );
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
        isBackgroundCompacting: false,
        streamingPhase: 'idle',
      });
      this.host.resetLivePane();
      const next = this.host.shiftQueuedMessage();
      if (next !== undefined) {
        setTimeout(() => {
          sendQueued(next);
        }, 0);
      }
    } else {
      this.host.setAppState({ isCompacting: false, isBackgroundCompacting: false });
    }
  }
}
