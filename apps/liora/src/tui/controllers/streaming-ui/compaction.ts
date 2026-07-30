import type { CompactionPhase } from '@superliora/sdk';

import { currentWorkingTip, tipText } from '../../components/chrome/working-tips';
import { CompactionComponent } from '../../components/dialogs/compaction';
import { appearanceAnimationNow } from '../../utils/appearance-effects';
import { isMotionTheatreActive, type MotionBeatController } from '../../utils/motion-beats';
import { requestTUILayoutRender } from '#/tui/utils/frame-render';
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
  requestTUILayoutRender(host.state);
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
  requestTUILayoutRender(host.state);
}
