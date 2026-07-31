/**
 * Settings → Eyes readiness — live browser/computer runtime glance (SSOT §9.2).
 */

import { getHostPackageRoot } from '#/cli/version';
import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { loadHarnessEyesReadiness } from '#/tui/utils/harness-eyes-readiness';
import {
  buildEyesSettingsLines,
  loadEyesSettingsGlance,
} from '#/tui/utils/eyes/eyes-glance';
import { formatErrorMessage } from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';

import type { SlashCommandHost } from '../hub/dispatch';

export function showEyesSettings(host: SlashCommandHost): void {
  void showEyesSettingsPanel(host);
}

async function showEyesSettingsPanel(host: SlashCommandHost): Promise<void> {
  let glance = loadEyesSettingsGlance({});
  try {
    const report = await loadHarnessEyesReadiness({ packageRoot: getHostPackageRoot() });
    glance = loadEyesSettingsGlance({ report });
  } catch (error) {
    glance = loadEyesSettingsGlance({ loadError: formatErrorMessage(error) });
  }

  const lines = buildEyesSettingsLines(glance);
  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Eyes readiness ',
    enterBeatSeed: 'eyes-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

/** Slash /eyes and legacy harness entry — same UsagePanel as Settings → Eyes. */
export async function showHarnessEyesReadiness(host: SlashCommandHost): Promise<void> {
  await showEyesSettingsPanel(host);
}
