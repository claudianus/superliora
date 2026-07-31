/**
 * Settings → Persona — live active name + customization tips (SSOT §9.2).
 */

import { resolveConfigPath } from '@superliora/sdk';

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildPersonaSettingsLines,
  type PersonaGlanceInput,
} from '#/tui/utils/persona/persona-glance';
import { getDataDir } from '#/utils/paths';

import type { SlashCommandHost } from '../hub/dispatch';

async function loadPersonaGlance(host: SlashCommandHost): Promise<PersonaGlanceInput> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });

  try {
    const config = await host.harness.getConfig({ reload: true });
    return {
      persona: config.persona,
      configPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { configPath, configError: message };
  }
}

export function showPersonaSettings(host: SlashCommandHost): void {
  void showPersonaSettingsPanel(host);
}

async function showPersonaSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadPersonaGlance(host);
  const lines = buildPersonaSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Persona ',
    enterBeatSeed: 'persona-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
