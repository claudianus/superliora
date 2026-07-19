import { IdleStageComponent } from '../components/chrome/idle-stage';
import { WelcomeComponent } from '../components/chrome/welcome';
import { requestTUILayoutRender } from '../utils/frame-render';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './dispatch';

/**
 * Temporarily cover the transcript with a Welcome-sized Jewel Tank.
 * The prior chat is restored when the next real message is added.
 */
export function handleAquariumCommand(host: SlashCommandHost): void {
  if (host.state.appState.isReplaying) {
    host.showError(ttui('tui.aquarium.replaying'));
    return;
  }

  const container = host.state.transcriptContainer;
  const appState = host.state.appState;
  container.showAquariumOverlay((addChrome) => {
    addChrome(new WelcomeComponent(appState));
    addChrome(
      new IdleStageComponent({
        state: appState,
        getPreferredRows: (width) => container.idleTargetRows(width),
      }),
    );
  });
  requestTUILayoutRender(host.state);
}
