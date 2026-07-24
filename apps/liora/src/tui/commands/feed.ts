import { IdleStageComponent } from '../components/chrome/idle-stage';
import { CHROME_GUTTER } from '../constant/rendering';
import { requestTUILayoutRender } from '../utils/frame-render';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './dispatch';

/**
 * Drop a pellet of food into the currently visible Jewel Tank.
 * Keyboard counterpart to the short-click feed handled by idle-feed-mouse:
 * it targets the first IdleStageComponent in the transcript (Welcome idle
 * stage or the /aquarium overlay) and lets the tank sim clamp the column.
 */
export function handleFeedCommand(host: SlashCommandHost): void {
  if (host.state.appState.isReplaying) {
    host.showError(ttui('tui.aquarium.replaying'));
    return;
  }

  const container = host.state.transcriptContainer;
  const tank = container.children.find(
    (child): child is IdleStageComponent => child instanceof IdleStageComponent,
  );
  if (tank === undefined) {
    host.showError(ttui('tui.feed.noTank'));
    return;
  }

  const innerWidth = transcriptInnerWidth(host);
  // A prior render initializes the tank sim; make sure it exists before dropping.
  tank.render(innerWidth);

  const col = 2 + Math.floor(Math.random() * Math.max(1, innerWidth - 4));
  if (!tank.tryDropFoodAtContent(col)) {
    host.showError(ttui('tui.feed.full'));
    return;
  }

  host.showStatus(ttui('tui.feed.dropped'));
  requestTUILayoutRender(host.state);
}

function transcriptInnerWidth(host: SlashCommandHost): number {
  const columns = host.state.terminal.columns;
  const width = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 80;
  return Math.max(8, width - CHROME_GUTTER - CHROME_GUTTER);
}
