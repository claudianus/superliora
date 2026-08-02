import type { CompactionPhase } from '@superliora/sdk';

import { currentWorkingTip, tipText } from '../../components/chrome/working-tips';
import { CompactionComponent } from '../../components/dialogs/session/compaction';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { isMotionTheatreActive, type MotionBeatController } from '../../utils/render/motion-beats';
import {
  requestTUIContentRender,
  requestTUILayoutRender,
} from '#/tui/utils/render/frame-render';
import type { TUIState } from '../../tui-state';

export interface CompactionHost {
  readonly state: TUIState;
  readonly motionBeats: MotionBeatController;
}

export function beginCompaction(
  host: CompactionHost,
  activeBlock: CompactionComponent | undefined,
  instruction?: string,
  options?: { readonly background?: boolean; readonly modelAlias?: string },
): CompactionComponent {
  const { state } = host;
  if (activeBlock !== undefined) {
    activeBlock.markDone();
  }
  const workingTip = currentWorkingTip();
  const block = new CompactionComponent(
    state.ui,
    instruction,
    workingTip === undefined ? undefined : tipText(workingTip),
    {
      background: options?.background === true,
      modelAlias: options?.modelAlias,
    },
  );
  state.transcriptContainer.addChild(block);
  host.motionBeats.play({
    name: 'compaction_start',
    seed: 'compaction',
    title: options?.background === true ? 'Compacting context (bg)' : 'Compacting context',
    nowMs: appearanceAnimationNow(),
    theatreActive: isMotionTheatreActive(state.appState),
  });
  // Structural: new transcript card → layout.
  requestTUILayoutRender(state);
  return block;
}

export function endCompaction(
  host: CompactionHost,
  activeBlock: CompactionComponent | undefined,
  tokensBefore?: number,
  tokensAfter?: number,
  detail?: string,
): undefined {
  if (activeBlock === undefined) return undefined;
  activeBlock.markDone(tokensBefore, tokensAfter, detail);
  const { state } = host;
  const tokenDelta =
    tokensBefore !== undefined && tokensAfter !== undefined
      ? `Compaction complete (${String(tokensBefore)} → ${String(tokensAfter)} tokens)`
      : 'Compaction complete';
  host.motionBeats.play({
    name: 'compaction_done',
    seed: 'compaction',
    title: tokenDelta,
    nowMs: appearanceAnimationNow(),
    theatreActive: isMotionTheatreActive(state.appState),
  });
  // Terminal state may drop progress/preview lines → layout.
  requestTUILayoutRender(state);
  return undefined;
}

export function cancelCompaction(
  host: CompactionHost,
  activeBlock: CompactionComponent | undefined,
): undefined {
  if (activeBlock === undefined) return undefined;
  activeBlock.markCanceled();
  requestTUILayoutRender(host.state);
  return undefined;
}

export function promoteCompactionToBlocking(
  host: CompactionHost,
  activeBlock: CompactionComponent | undefined,
): void {
  if (activeBlock === undefined) return;
  activeBlock.promoteToBlocking();
  // Header label change only — content is enough.
  requestTUIContentRender(host.state);
}

export function updateCompactionProgress(
  host: CompactionHost,
  activeBlock: CompactionComponent | undefined,
  phase: CompactionPhase,
  delta?: string,
  meta?: {
    readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
    readonly blockIndex?: number;
    readonly blockCount?: number;
    readonly blocksCompleted?: number;
    readonly fraction?: number;
  },
): void {
  if (activeBlock === undefined) return;
  activeBlock.setPhase(phase);
  if (meta !== undefined) {
    activeBlock.setStreamMeta(meta);
  }
  if (delta !== undefined && delta.length > 0) {
    activeBlock.appendSummaryDelta(delta);
  }
  // Progress ticks stream many times per second. Layout invalidation rebuilds
  // transcript geometry every token and flickers the stage; content is enough
  // because the card already owns fixed slots for bar + preview lines.
  requestTUIContentRender(host.state);
}
