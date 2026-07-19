import { IdleStageComponent } from '../components/chrome/idle-stage';
import { requestTUILayoutRender } from '../utils/frame-render';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './dispatch';

/** Remount or resurface the Jewel Tank when the empty-session aquarium is gone. */
export function handleAquariumCommand(host: SlashCommandHost): void {
  if (host.state.appState.isReplaying) {
    host.showError(ttui('tui.aquarium.replaying'));
    return;
  }

  const container = host.state.transcriptContainer;
  const existing = container.children.find(
    (child): child is IdleStageComponent => child instanceof IdleStageComponent,
  );

  if (existing !== undefined) {
    // Keep the live sim; just bring the stage to the end so it is on-screen.
    container.removeChild(existing);
    container.addChild(existing);
    requestTUILayoutRender(host.state);
    return;
  }

  // Status children dismiss idle stages — post the notice first, then mount.
  host.showStatus(ttui('tui.aquarium.restored'), 'success');
  container.addChild(
    new IdleStageComponent({
      state: host.state.appState,
      getPreferredRows: (width) => container.idleTargetRows(width),
    }),
  );
  requestTUILayoutRender(host.state);
}
