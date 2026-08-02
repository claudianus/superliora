/**
 * Settings → Index — RepoQuery / codemap / RepoIndex wire status + rebuild (Sovereign Reform §6).
 */

import { getCodemapStatus, getRepoIndexStatus, rebuildRepoIndex } from '@superliora/sdk';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildIndexSettingsLines,
  INDEX_ENGINE_TIP,
  INDEX_FTS_TIP,
  INDEX_WARM_TIP,
} from '../../../utils/index/index-glance';

import type { SlashCommandHost } from '../../hub/dispatch';

export { INDEX_ENGINE_TIP, INDEX_FTS_TIP, INDEX_WARM_TIP };

export function showIndexSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Repo index',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Index status',
          description: 'RepoQuery registration, codemap warmth, FTS engine wire probe.',
        },
        {
          value: 'rebuild',
          label: 'Rebuild now',
          description: 'Clear and rebuild symbol codemap + sqlite FTS content index.',
        },

      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'rebuild') {
          void showIndexRebuildPanel(host);
          return;
        }
        if (value === 'status') {
          void showIndexSettingsPanel(host);
          return;
        }

      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Index' },
  );
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

async function resolveRepoQueryActive(host: SlashCommandHost): Promise<boolean> {
  try {
    const session = host.requireSession();
    if (typeof session.getTools === 'function') {
      const tools = await session.getTools();
      return tools.some((tool) => tool.name === 'RepoQuery' && tool.active);
    }
  } catch {
    /* keep false */
  }
  return false;
}

async function showIndexSettingsPanel(
  host: SlashCommandHost,
  rebuildResult?: ReturnType<typeof rebuildRepoIndex>,
): Promise<void> {
  const workDir = resolveIndexWorkDir(host);
  const env = process.env;
  const repoQueryActive = await resolveRepoQueryActive(host);
  const repoIndex = getRepoIndexStatus(env);
  const codemap = getCodemapStatus(workDir);
  const lines = buildIndexSettingsLines({
    repoQueryActive,
    codemap,
    repoIndex,
    env,
    rebuildResult,
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Index ',
    enterBeatSeed: 'index',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

async function showIndexRebuildPanel(host: SlashCommandHost): Promise<void> {
  const workDir = resolveIndexWorkDir(host);
  const rebuildResult = rebuildRepoIndex(workDir);
  if (rebuildResult.ok) {
    host.showStatus('Repo index rebuild finished.', 'success');
  } else {
    host.showStatus(
      rebuildResult.note ?? 'Repo index rebuild failed.',
      'warning',
    );
  }
  await showIndexSettingsPanel(host, rebuildResult);
}
