/**
 * Workspace session drawer — Active / Recent / Archived jobs for this repo.
 * Continue here adopts into the current chat; archive shelves without deleting files.
 */

import { ChoicePickerComponent, type ChoiceOption } from '../components/dialogs/picker/choice-picker';
import { shortJobId } from '../components/job-board/job-board-helpers';
import { resyncJobBoardFromSession } from '../features/control-tower/job-resync';
import { ttui } from '../utils/tui-i18n';
import {
  dismissPickerDialog,
  mountPickerDialog,
} from '../utils/ui/mount-picker';
import type { SlashCommandHost } from './hub/dispatch';
import { isConductorUxV2Enabled } from './job-hotpath';

const CONTINUE_PREFIX = 'continue:';
const ARCHIVE_PREFIX = 'archive:';

export function isDrawerArgs(args: string): boolean {
  return args === 'drawer' || args === 'sessions' || args === 'shelf';
}

export async function openJobsDrawer(host: SlashCommandHost): Promise<void> {
  if (host.session === undefined) {
    host.showError(ttui('tui.jobs.deckNoSession'));
    return;
  }
  if (!isConductorUxV2Enabled()) {
    host.showStatus(ttui('tui.jobs.drawerNeedsUx'), 'warning');
    return;
  }
  try {
    const catalog = await host.requireSession().jobWorkspaceCatalog();
    const options = buildDrawerOptions(catalog.rows);
    if (options.length === 0) {
      host.showStatus(ttui('tui.jobs.drawerEmpty'), 'textMuted');
      return;
    }
    mountPickerDialog(
      host,
      new ChoicePickerComponent({
        title: ttui('tui.jobs.drawerTitle'),
        hint: ttui('tui.jobs.drawerHint'),
        searchable: true,
        options,
        onSelect: (value) => {
          dismissPickerDialog(host);
          void handleDrawerSelect(host, value);
        },
        onCancel: () => {
          dismissPickerDialog(host);
        },
      }),
    );
  } catch (error) {
    host.showError(
      error instanceof Error ? error.message : ttui('tui.jobs.drawerFailed'),
    );
  }
}

function buildDrawerOptions(
  rows: readonly {
    readonly jobId: string;
    readonly title: string;
    readonly status: string;
    readonly shelf: string;
    readonly local: boolean;
    readonly sourceAgentDir?: string;
    readonly sessionName?: string;
    readonly landChoice?: string;
  }[],
): ChoiceOption[] {
  const sectionFor = (shelf: string): string => {
    if (shelf === 'active') return ttui('tui.jobs.drawerSectionActive');
    if (shelf === 'recent') return ttui('tui.jobs.drawerSectionRecent');
    return ttui('tui.jobs.drawerSectionArchived');
  };
  const options: ChoiceOption[] = [];
  for (const row of rows) {
    const id = shortJobId(row.jobId);
    const handle = row.sessionName?.trim() || row.title;
    const where = row.local ? ttui('tui.jobs.drawerThisChat') : ttui('tui.jobs.drawerOtherChat');
    const land =
      row.landChoice === 'pending' ? ttui('tui.jobs.drawerNeedsLand') : undefined;
    options.push({
      value: `${CONTINUE_PREFIX}${row.jobId}`,
      label: `${handle}  ${row.status}  ${id}`,
      section: sectionFor(row.shelf),
      description: [where, land].filter(Boolean).join(' · '),
      keywords: [row.jobId, row.title, row.status, row.shelf, handle],
    });
    if (row.shelf !== 'archived') {
      options.push({
        value: `${ARCHIVE_PREFIX}${row.jobId}`,
        label: ttui('tui.jobs.drawerArchiveRow', { title: row.title }),
        section: sectionFor(row.shelf),
        tone: 'danger',
        keywords: ['archive', row.jobId, row.title],
      });
    }
  }
  return options;
}

async function handleDrawerSelect(host: SlashCommandHost, value: string): Promise<void> {
  const session = host.requireSession();
  if (value.startsWith(ARCHIVE_PREFIX)) {
    const jobId = value.slice(ARCHIVE_PREFIX.length);
    const result = await session.jobArchiveWorkspace(jobId);
    if (!result.ok) {
      host.showError(result.error ?? result.text);
      return;
    }
    host.showStatus(result.text, 'success');
    return;
  }
  if (!value.startsWith(CONTINUE_PREFIX)) return;
  const jobId = value.slice(CONTINUE_PREFIX.length);
  const result = await session.jobAdoptWorkspace(jobId);
  if (!result.ok) {
    host.showError(result.error ?? result.text);
    return;
  }
  host.showStatus(result.text, 'success');
  await resyncJobBoardFromSession(host);
}
