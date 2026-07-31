/**
 * Settings → Experiments — live feature flags from config (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildExperimentsSettingsLines,
  type ExperimentsGlanceInput,
} from '#/tui/utils/experiments/experiments-glance';

import type { SlashCommandHost } from '../../hub/dispatch';

async function loadExperimentsGlance(host: SlashCommandHost): Promise<ExperimentsGlanceInput> {
  try {
    const features = await host.harness.getExperimentalFeatures();
    return { features };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { loadError: message };
  }
}

export function showExperimentsSettings(host: SlashCommandHost): void {
  void showExperimentsSettingsPanel(host);
}

async function showExperimentsSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadExperimentsGlance(host);
  const lines = buildExperimentsSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Experiments ',
    enterBeatSeed: 'experiments-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
