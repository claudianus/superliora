/**
 * Settings → Host — runtime glance + workspace dirs via /add-dir (Sovereign Reform §9.2 / W8).
 * No transport switch until config schema lands; status panel shows live TTFT when available.
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { PlainTextInputDialogComponent } from '../../../components/dialogs/shared/plain-text-input-dialog';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import { buildHostSessionLiveLines } from '../../../utils/host/sovereign-umbrella-glance';
import {
  HOST_FUTURE_TIP,
  HOST_SOVEREIGN_UMBRELLA_TIP,
  HOST_TTFT_TIP,
  loadHostGlance,
  buildHostSettingsLines,
} from '../../../utils/host/host-glance';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { handleAddDirCommand } from '../../session/add-dir';

import type { SlashCommandHost } from '../../hub/dispatch';

export { HOST_FUTURE_TIP, HOST_SOVEREIGN_UMBRELLA_TIP, HOST_TTFT_TIP };

export function showHostSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Host',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Host status',
          description:
            'In-process vs server client · transport · local daemon · live TTFT sample.',
        },
        {
          value: 'dirs-list',
          label: 'List workspace dirs',
          description: 'Additional roots from /add-dir (session + remembered).',
        },
        {
          value: 'dirs-add',
          label: 'Add workspace dir…',
          description: 'Path → session-only or remember in .superliora/local.toml',
        },
        {
          value: 'dirs-remove',
          label: 'Remove workspace dir…',
          description: 'Pick a root to drop for this session (persisted dirs: edit local.toml).',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showHostSettingsPanel(host);
          return;
        }
        if (value === 'dirs-list') {
          void handleAddDirCommand(host, 'list');
          return;
        }
        if (value === 'dirs-add') {
          mountPickerDialog(
            host,
            new PlainTextInputDialogComponent({
              title: 'Add workspace directory',
              prefill: '',
              allowEmpty: false,
              onDone: (result) => {
                dismissPickerDialog(host);
                if (result.kind !== 'ok') return;
                void handleAddDirCommand(host, result.value.trim());
              },
            }),
            { label: 'Add dir' },
          );
          return;
        }
        if (value === 'dirs-remove') {
          showRemoveWorkspaceDirPicker(host);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Host' },
  );
}

function showRemoveWorkspaceDirPicker(host: SlashCommandHost): void {
  const dirs =
    host.session?.summary?.additionalDirs ??
    host.state.appState.additionalDirs ??
    [];
  if (dirs.length === 0) {
    host.showStatus('No additional directories configured.');
    return;
  }
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Remove workspace directory',
      hint: 'Session drop only · persisted roots need local.toml edit · Esc cancel',
      options: dirs.map((dir) => ({
        value: dir,
        label: dir,
        description: 'Drop from this session’s additional roots',
      })),
      onSelect: (dir) => {
        dismissPickerDialog(host);
        void removeWorkspaceDir(host, dir);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Remove dir' },
  );
}

async function removeWorkspaceDir(host: SlashCommandHost, dir: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showStatus('No active session — edit .superliora/local.toml to drop remembered dirs.');
    return;
  }
  // ponytail: SDK exposes addAdditionalDir only; session.setAdditionalDirs is agent-core-side.
  // Prefer filtering appState + best-effort cast when present.
  const current =
    session.summary?.additionalDirs ?? host.state.appState.additionalDirs ?? [];
  const next = current.filter((entry) => entry !== dir);
  const mutable = session as {
    setAdditionalDirs?: (dirs: readonly string[]) => Promise<void>;
  };
  if (typeof mutable.setAdditionalDirs === 'function') {
    try {
      await mutable.setAdditionalDirs(next);
      host.setAppState({ additionalDirs: [...next] });
      host.refreshSlashCommandAutocomplete();
      host.showStatus(`Removed workspace directory for this session:\n  ${dir}`, 'success');
      return;
    } catch (error) {
      host.showError(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  host.setAppState({ additionalDirs: [...next] });
  host.showStatus(
    `Dropped ${dir} from the TUI list for this session.\n` +
      'Persisted roots still live in .superliora/local.toml — edit that file to forget permanently.',
  );
}

async function showHostSettingsPanel(host: SlashCommandHost): Promise<void> {
  let sessionId: string | undefined;
  let workDir: string | undefined;
  try {
    const session = host.requireSession();
    sessionId = session.id;
    workDir = session.workDir ?? host.state.appState.workDir;
  } catch {
    workDir = host.state.appState.workDir;
  }

  const env = process.env;
  const glance = loadHostGlance({
    harness: host.harness,
    env,
    sessionId,
    workDir,
    lastStepTtft: host.state.appState.lastStepTtft ?? null,
    lastStepTtftMsWindow: host.state.appState.lastStepTtftMsWindow ?? null,
  });
  const lines = buildHostSettingsLines({
    ...glance,
    sessionLiveLines: buildHostSessionLiveLines({ env }),
  });

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Host ',
    enterBeatSeed: 'host',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
