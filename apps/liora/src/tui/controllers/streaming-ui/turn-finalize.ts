import type { CompactionPhase } from '@superliora/sdk';

import type { CompactionComponent } from '../../components/dialogs/session/compaction';
import type { QueuedMessage } from '../../types';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import { notifyUserAttentionOnce } from '../../utils/terminal/terminal-notification';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import {
  beginCompaction as beginCompactionHelper,
  cancelCompaction as cancelCompactionHelper,
  endCompaction as endCompactionHelper,
  promoteCompactionToBlocking as promoteCompactionToBlockingHelper,
  updateCompactionProgress as updateCompactionProgressHelper,
} from './compaction';
import type { StreamingUIHost } from './host-types';
import type { AssistantMessageComponent } from '../../components/messages/assistant-message';

export function finalizeStreamingTurn(args: {
  host: StreamingUIHost;
  currentTurnId: string | undefined;
  getStreamingBlockComponent: () => AssistantMessageComponent | undefined;
  finalizeLiveTextBuffers: () => void;
  resetToolCallState: () => void;
  setCurrentTurnId: (turnId: string | undefined) => void;
  sendQueued: (item: QueuedMessage) => void;
}): void {
  const { state } = args.host;
  if (state.appState.streamingPhase === 'idle') return;
  args.host.deferUserMessages = false;
  const completedTurnKey =
    args.currentTurnId ?? `local:${String(state.appState.streamingStartTime)}`;
  const closingAssistantBlock = args.getStreamingBlockComponent();
  args.finalizeLiveTextBuffers();
  if (closingAssistantBlock !== undefined) {
    closingAssistantBlock.markTurnEndCue(appearanceAnimationNow());
  }
  args.resetToolCallState();
  args.setCurrentTurnId(undefined);

  const next = args.host.shiftQueuedMessage();
  if (next !== undefined) {
    args.host.setAppState({ streamingPhase: 'idle' });
    args.host.resetLivePane();
    setTimeout(() => {
      args.sendQueued(next);
    }, 0);
    return;
  }

  args.host.setAppState({ streamingPhase: 'idle' });
  args.host.resetLivePane();
  notifyUserAttentionOnce(state, `turn-complete:${completedTurnKey}`, {
    title: 'SuperLiora task complete',
    body: state.appState.sessionTitle ?? undefined,
  });
}

export function runStreamingCompactionAction(
  host: StreamingUIHost,
  activeCompactionBlock: CompactionComponent | undefined,
  action:
    | {
        readonly kind: 'begin';
        readonly instruction?: string;
        readonly options?: { readonly background?: boolean; readonly modelAlias?: string };
      }
    | {
        readonly kind: 'end';
        readonly tokensBefore?: number;
        readonly tokensAfter?: number;
        readonly detail?: string;
      }
    | { readonly kind: 'cancel' }
    | { readonly kind: 'promote' }
    | {
        readonly kind: 'progress';
        readonly phase: CompactionPhase;
        readonly delta?: string;
        readonly meta?: {
          readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
          readonly blockIndex?: number;
          readonly blockCount?: number;
          readonly blocksCompleted?: number;
          readonly fraction?: number;
        };
      },
): CompactionComponent | undefined {
  switch (action.kind) {
    case 'begin':
      return beginCompactionHelper(host, activeCompactionBlock, action.instruction, action.options);
    case 'end':
      {  endCompactionHelper(
        host,
        activeCompactionBlock,
        action.tokensBefore,
        action.tokensAfter,
        action.detail,
      );; return; }
    case 'cancel':
      {  cancelCompactionHelper(host, activeCompactionBlock);; return; }
    case 'promote':
      promoteCompactionToBlockingHelper(host, activeCompactionBlock);
      return activeCompactionBlock;
    case 'progress':
      updateCompactionProgressHelper(host, activeCompactionBlock, action.phase, action.delta, action.meta);
      requestTUILayoutRender(host.state);
      return activeCompactionBlock;
  }
}
