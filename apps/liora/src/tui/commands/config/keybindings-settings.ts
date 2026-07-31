/**
 * Settings → Keyboard / Keybindings — read-only keymap tips (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildKeybindingsSettingsLines,
  loadKeybindingsGlance,
} from '../../utils/keymap/keybindings-glance';

import type { SlashCommandHost } from '../hub/dispatch';

export function showKeybindingsSettings(host: SlashCommandHost): void {
  const glance = loadKeybindingsGlance();
  const lines = buildKeybindingsSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Keybindings ',
    enterBeatSeed: 'keybindings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
