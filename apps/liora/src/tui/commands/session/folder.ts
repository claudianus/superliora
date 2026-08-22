import { basename } from 'node:path';

import { ChoicePickerComponent, type ChoiceOption } from '../../components/dialogs/picker/choice-picker';
import { ttui } from '../../utils/tui-i18n';
import {
  dismissPickerDialog,
  mountPickerDialog,
  type PickerMountHost,
} from '../../utils/ui/mount-picker';
import {
  displayWorkspacePath,
  isGenericLaunchDir,
  listWorkspaceChildren,
  parentWorkspaceDir,
  resolveExistingWorkspaceDir,
  uniqueRecentWorkDirs,
  wellKnownPlaces,
} from '../../utils/workspace';
import type { SlashCommandHost } from '../hub/dispatch';

export interface FolderPickerHost extends PickerMountHost {
  readonly state: PickerMountHost['state'] & {
    readonly appState: { readonly workDir: string };
  };
  readonly harness: {
    listSessions(input?: { readonly workDir?: string }): Promise<
      readonly { readonly workDir: string; readonly updatedAt?: number }[]
    >;
  };
  openWorkspace(dir: string, options?: { readonly resumeSessionId?: string }): Promise<void>;
  showStatus(msg: string, color?: string): void;
}

const OPEN_PREFIX = 'open:';
const BROWSE_PREFIX = 'browse:';

export async function handleFolderCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (host.state.appState.streamingPhase !== 'idle' || host.state.appState.isCompacting) {
    host.showError(ttui('tui.folder.busy'));
    return;
  }
  const input = args.trim();
  if (input.length > 0) {
    await host.openWorkspace(input);
    return;
  }
  await showFolderPicker(host);
}

export async function showFolderPicker(
  host: FolderPickerHost,
  options: {
    readonly browseRoot?: string;
    readonly startup?: boolean;
  } = {},
): Promise<void> {
  const current = host.state.appState.workDir;
  const browseRoot = options.browseRoot ?? current;
  const pickerOptions = await buildFolderPickerOptions(host, browseRoot, current);
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.folder.title'),
      hint: ttui('tui.folder.hint'),
      notice: options.startup === true ? ttui('tui.folder.notice.startup') : undefined,
      noticeTone: 'warning',
      searchable: true,
      currentValue: `${OPEN_PREFIX}${current}`,
      options: pickerOptions,
      onSelect: (value) => {
        if (value.startsWith(BROWSE_PREFIX)) {
          const nextRoot = value.slice(BROWSE_PREFIX.length);
          void showFolderPicker(host, { browseRoot: nextRoot, startup: options.startup });
          return;
        }
        dismissPickerDialog(host);
        if (value.startsWith(OPEN_PREFIX)) {
          void host.openWorkspace(value.slice(OPEN_PREFIX.length));
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
        if (options.startup === true) {
          host.showStatus(ttui('tui.folder.stayed', { path: displayWorkspacePath(current) }));
        }
      },
    }),
  );
}

async function buildFolderPickerOptions(
  host: FolderPickerHost,
  browseRoot: string,
  current: string,
): Promise<ChoiceOption[]> {
  const options: ChoiceOption[] = [];
  let sessions: readonly { workDir: string; updatedAt?: number }[] = [];
  try {
    sessions = await host.harness.listSessions({});
  } catch {
    sessions = [];
  }
  const recents = uniqueRecentWorkDirs(sessions, { exclude: current, limit: 8 });
  for (const dir of recents) {
    options.push({
      value: `${OPEN_PREFIX}${dir}`,
      label: basename(dir) || dir,
      description: displayWorkspacePath(dir),
      section: ttui('tui.folder.section.recent'),
    });
  }

  for (const place of wellKnownPlaces()) {
    options.push({
      value: `${BROWSE_PREFIX}${place.path}`,
      label: place.label,
      description: displayWorkspacePath(place.path),
      section: ttui('tui.folder.section.places'),
    });
  }

  options.push({
    value: `${OPEN_PREFIX}${browseRoot}`,
    label: ttui('tui.folder.openHere'),
    description: displayWorkspacePath(browseRoot),
    section: ttui('tui.folder.section.here'),
  });
  const parent = parentWorkspaceDir(browseRoot);
  if (parent !== undefined) {
    options.push({
      value: `${BROWSE_PREFIX}${parent}`,
      label: '..',
      description: displayWorkspacePath(parent),
      section: ttui('tui.folder.section.here'),
    });
  }
  for (const child of listWorkspaceChildren(browseRoot)) {
    options.push({
      value: `${OPEN_PREFIX}${child}`,
      label: basename(child),
      description: displayWorkspacePath(child),
      section: ttui('tui.folder.section.here'),
    });
  }
  return options;
}

export function folderResolveErrorMessage(result: ReturnType<typeof resolveExistingWorkspaceDir>): string {
  if (result.ok) return '';
  if (result.reason === 'empty') return ttui('tui.folder.empty');
  if (result.reason === 'not-dir') return ttui('tui.folder.notDir', { path: result.path });
  return ttui('tui.folder.missing', { path: result.path });
}

export function shouldOfferStartupFolderPicker(workDir: string): boolean {
  return isGenericLaunchDir(workDir);
}
