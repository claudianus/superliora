import { IdleStageComponent } from '../components/chrome/idle-stage';
import { requestTUILayoutRender } from '../utils/frame-render';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './dispatch';

/** Remount the Jewel Tank so it fills the live transcript viewport. */
export function handleAquariumCommand(host: SlashCommandHost): void {
  if (host.state.appState.isReplaying) {
    host.showError(ttui('tui.aquarium.replaying'));
    return;
  }

  const container = host.state.transcriptContainer;
  // Always remount: restore sizing to the full transcript budget (chat history
  // must not shrink the tank the way idleTargetRows does on empty sessions).
  container.dismissIdleStage();

  // Status children dismiss idle stages — post the notice first, then mount.
  host.showStatus(ttui('tui.aquarium.restored'), 'success');
  container.addChild(
    new IdleStageComponent({
      state: host.state.appState,
      getPreferredRows: (width) => container.transcriptRows(width),
    }),
  );
  requestTUILayoutRender(host.state);
}
