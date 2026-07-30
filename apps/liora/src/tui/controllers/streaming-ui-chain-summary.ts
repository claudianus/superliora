import { ToolChainSummaryComponent } from '../components/messages/tool-chain-summary';
import { UserMessageComponent } from '../components/messages/user-message';
import type { TUIState } from '../tui-state';
import { requestTUILayoutRender } from '#/tui/utils/frame-render';

/** Per-turn minimal-density tool chain summary mount state. */
export interface ChainSummaryState {
  active: ToolChainSummaryComponent | null;
  turnIndex: number;
}

/**
 * Minimal-density chain summary lifecycle: one summary per turn. A new
 * user message (turn boundary index change) or a prior settle closes the
 * active summary before a fresh one mounts.
 */
export function ensureChainSummary(
  state: TUIState,
  chain: ChainSummaryState,
): ToolChainSummaryComponent {
  const children = state.transcriptContainer.children;
  let lastUserIndex = -1;
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i] instanceof UserMessageComponent) {
      lastUserIndex = i;
      break;
    }
  }
  if (
    chain.active !== null &&
    (chain.active.isSettled() || chain.turnIndex !== lastUserIndex)
  ) {
    chain.active.settle();
    chain.active = null;
  }
  if (chain.active === null) {
    chain.active = new ToolChainSummaryComponent();
    chain.turnIndex = lastUserIndex;
    state.transcriptContainer.addChild(chain.active);
    requestTUILayoutRender(state);
  }
  return chain.active;
}

export function settleActiveChainSummary(chain: ChainSummaryState): void {
  if (chain.active === null) return;
  chain.active.settle();
  chain.active = null;
}
