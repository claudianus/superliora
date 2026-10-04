/**
 * `/rewind` — retired. File rewind restored per-turn snapshots that only the
 * dedicated Write/Edit/ApplyPatch tools captured; the agent now edits through
 * Bash, so there is nothing to restore. The command stays registered (hidden
 * from help and completion) so typing it prints git rollback guidance instead
 * of reaching the model as a prompt it could read as "revert my files".
 */

import { ttui } from '../../utils/tui-i18n';
import type { SlashCommandHost } from '../hub/dispatch';

export function handleRewindCommand(host: SlashCommandHost): void {
  host.showNotice(ttui('tui.rewind.retired.title'), ttui('tui.rewind.retired.detail'), {
    coalesceKey: 'rewind-retired',
  });
}
