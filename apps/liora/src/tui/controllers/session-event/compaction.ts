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
  /** Optional — overflow-recovery notice (Loop25b). */
  showNotice?(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  showStatus?(msg: string, color?: string): void;
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
    // Loop25b: overflow recovery is reactive (API window exceeded), not quiet pre-rot.
    if (event.trigger === 'overflow' && this.host.showNotice !== undefined) {
      this.host.showNotice(
        'Context overflow recovery',
        'API context window was exceeded. Compacting so the turn can continue — progress may pause briefly.',
        { coalesceKey: 'context-overflow-recovery' },
      );
      this.host.showStatus?.('Compacting after context overflow…', 'warning');
    }
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

  handleBlocked(event: CompactionBlockedEvent): void {
    // Background pre-rot has been awaited by the turn: promote to blocking UX.
    if (!this.host.state.appState.isBackgroundCompacting && !this.host.state.appState.isCompacting) {
      return;
    }
    const wasBackground = this.host.state.appState.isBackgroundCompacting === true;
    this.host.streamingUI.finalizeLiveTextBuffers('waiting');
    this.host.setAppState({
      isCompacting: true,
      isBackgroundCompacting: false,
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
    this.host.streamingUI.promoteCompactionToBlocking();
    // Loop30a: operator-visible pause — badge-only promotion is easy to miss mid-turn.
    if (this.host.showNotice !== undefined) {
      const turn =
        event.turnId !== undefined ? ` (turn ${String(event.turnId)})` : '';
      this.host.showNotice(
        'Compaction blocking turn',
        wasBackground
          ? `Background context compaction is still running; the turn is waiting for it to finish${turn}. Live tools pause until compact completes.`
          : `The turn is waiting on in-flight context compaction${turn}. Progress may pause until compact completes.`,
        { coalesceKey: 'compaction-blocked' },
      );
      this.host.showStatus?.(
        wasBackground
          ? 'Turn paused: waiting on background compaction…'
          : 'Turn paused: waiting on compaction…',
        'warning',
      );
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
