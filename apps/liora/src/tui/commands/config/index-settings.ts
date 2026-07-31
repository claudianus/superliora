/**
 * Settings → Index — read-only RepoQuery / codemap / RepoIndex wire status (Sovereign Reform §6).
 */

import { getCodemapStatus, getRepoIndexStatus } from '@superliora/sdk';

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { buildIndexSettingsLines } from '../../utils/index/index-glance';

import type { SlashCommandHost } from '../hub/dispatch';

export function showIndexSettings(host: SlashCommandHost): void {
  void showIndexSettingsPanel(host);
}

function resolveIndexWorkDir(host: SlashCommandHost): string {
  try {
    const session = host.requireSession();
    const fromSession = session.workDir?.trim();
    if (fromSession !== undefined && fromSession.length > 0) return fromSession;
  } catch {
    /* optional */
  }
  const fromState = host.state.appState.workDir?.trim();
  return fromState !== undefined && fromState.length > 0 ? fromState : process.cwd();
}

async function showIndexSettingsPanel(host: SlashCommandHost): Promise<void> {
  let hasRepoQuery = false;
  try {
    const session = host.requireSession();
    if (typeof session.getTools === 'function') {
      const tools = await session.getTools();
      hasRepoQuery = tools.some((tool) => tool.name === 'RepoQuery' && tool.active);
    }
  } catch {
    /* keep false — read-only */
  }

  const workDir = resolveIndexWorkDir(host);
  const repoIndex = getRepoIndexStatus();
  const codemap = getCodemapStatus(workDir);
  const lines = buildIndexSettingsLines({
    repoQueryActive: hasRepoQuery,
    codemap,
    repoIndex,
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Index ',
    enterBeatSeed: 'index',
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
