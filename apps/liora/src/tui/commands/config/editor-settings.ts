/**
 * Settings → Editor — live inputMode + external editor glance (SSOT §9.2).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import {
  buildEditorSettingsLines,
  loadEditorGlance,
} from '#/tui/utils/editor/editor-glance';
import { requestTUILayoutRender } from '../../utils/render/frame-render';

import type { SlashCommandHost } from '../hub/dispatch';

export function showEditorSettings(host: SlashCommandHost): void {
  const glance = loadEditorGlance({
    inputMode: host.state.appState.inputMode,
    editorCommand: host.state.appState.editorCommand,
  });
  const lines = buildEditorSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Editor ',
    enterBeatSeed: 'editor-settings',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
