/**
 * Settings → Harness → Settings inventory — audit aid listing every
 * SettingsSelection entry (SSOT §9).
 */

import { SETTINGS_OPTIONS } from '../../components/dialogs/picker/settings-selector';
import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';

import type { SlashCommandHost } from '../hub/dispatch';

export function showSettingsInventory(host: SlashCommandHost): void {
  const lines = [
    '── Settings SSOT inventory (§9) ────────────',
    `${String(SETTINGS_OPTIONS.length)} entries · Settings → picker values`,
    '',
    ...SETTINGS_OPTIONS.map(
      (opt) => `${opt.label.padEnd(18)}  ${opt.value.padEnd(14)}  ${opt.description}`,
    ),
  ];

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Settings ',
    enterBeatSeed: 'settings-inventory',
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
