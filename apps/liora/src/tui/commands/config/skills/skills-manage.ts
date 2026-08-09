/**
 * TUI Skills manage — enable/disable slash activation + install from path.
 */

import { PlainTextInputDialogComponent } from '../../../components/dialogs/shared/plain-text-input-dialog';
import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { formatErrorMessage } from '../../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import { installSkillFromPath } from '#/utils/skills/skills-install';
import {
  isSkillDisabled,
  loadSkillsState,
  setSkillDisabled,
} from '#/utils/skills/skills-state';

import { extensionsReloadAppStatePatch } from '#/tui/components/chrome/footer/footer-badges';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export async function showSkillsManagePanel(host: SlashCommandHost): Promise<void> {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Skills',
      hint: '↑↓ · Enter · Esc · Claude-compatible dirs',
      searchable: true,
      options: [
        {
          value: 'toggle',
          label: 'Enable / disable',
          description: 'Toggle slash activation (skills-state.json).',
        },
        {
          value: 'install',
          label: 'Install from path',
          description: 'Copy a SKILL.md directory into ~/.superliora/skills.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'toggle') void showToggleList(host);
        else if (value === 'install') promptInstall(host);
      },
      onCancel: () =>{  dismissPickerDialog(host); },
    }),
    { label: 'Skills' },
  );
}

async function showToggleList(host: SlashCommandHost): Promise<void> {
  let summaries: readonly { name: string; description: string }[];
  try {
    const listed = await host.requireSession().listSkills();
    summaries = listed.map((s) => ({
      name: s.name,
      description: s.description,
    }));
  } catch (error) {
    host.showError(ttui('tui.skills.listFailed', { message: formatErrorMessage(error) }));
    return;
  }

  const state = await loadSkillsState();
  if (summaries.length === 0) {
    host.showStatus(ttui('tui.skills.none'));
    return;
  }

  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Toggle skills',
      hint: 'Enter toggles enable/disable · Esc',
      searchable: true,
      options: summaries.map((skill) => {
        const disabled = isSkillDisabled(state, skill.name);
        return {
          value: skill.name,
          label: skill.name,
          description: `${disabled ? 'disabled' : 'enabled'}${skill.description ? ` · ${skill.description}` : ''}`,
        };
      }),
      onSelect: (name) => {
        void (async () => {
          dismissPickerDialog(host);
          const current = await loadSkillsState();
          const nextDisabled = !isSkillDisabled(current, name);
          await setSkillDisabled(name, nextDisabled);
          host.showStatus(ttui('tui.skills.toggled', { action: nextDisabled ? ttui('tui.skills.disabledWord') : ttui('tui.skills.enabledWord'), name }));
          if (typeof host.refreshDynamicSlashCommands === 'function') {
            await host.refreshDynamicSlashCommands(host.requireSession());
          } else if (typeof host.refreshSkillCommands === 'function') {
            await host.refreshSkillCommands(host.requireSession());
          }
          await showToggleList(host);
        })();
      },
      onCancel: () =>{  dismissPickerDialog(host); },
    }),
    { label: 'Skills' },
  );
}

function promptInstall(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new PlainTextInputDialogComponent({
      title: 'Install skill path',
      subtitleLines: ['Directory containing SKILL.md', 'e.g. ./my-skill or ~/.claude/skills/foo'],
      onDone: (result) => {
        dismissPickerDialog(host);
        if (result.kind === 'ok') void runInstall(host, result.value);
      },
    }),
    { label: 'Skills' },
  );
}

async function runInstall(host: SlashCommandHost, path: string): Promise<void> {
  try {
    const { name, dest } = await installSkillFromPath(path);
    host.showStatus(ttui('tui.skills.installed', { name, dest }));
    try {
      await host.requireSession().reloadSession({ forcePluginSessionStartReminder: true });
      host.setAppState(extensionsReloadAppStatePatch());
    } catch {
      // Config path write succeeded; map refresh may still work.
    }
    if (typeof host.refreshDynamicSlashCommands === 'function') {
      await host.refreshDynamicSlashCommands(host.requireSession());
    }
  } catch (error) {
    host.showError(ttui('tui.skills.installFailed', { message: formatErrorMessage(error) }));
  }
}
