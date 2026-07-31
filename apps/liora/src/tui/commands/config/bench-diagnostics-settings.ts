/**
 * Settings → Bench / Diagnostics — read-only /bench, /ops tips (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { buildBenchDiagnosticsSettingsLines } from '../../utils/bench/bench-diagnostics-glance';

import type { SlashCommandHost } from '../hub/dispatch';

export function showBenchDiagnosticsSettings(host: SlashCommandHost): void {
  const lines = buildBenchDiagnosticsSettingsLines();

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Bench ',
    enterBeatSeed: 'bench-diagnostics',
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
