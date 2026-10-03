import {
  getBuiltinSlashCommands,
  jobArgumentCompletions,
  slashCommandsForHelp,
  sortSlashCommands,
  thinkingArgumentCompletionsForModel,
  type LioraSlashCommand,
  type SlashCommandHelpMode,
} from '../../commands';
import { shortJobId } from '../../components/job-board/job-board-helpers';
import {
  FileMentionProvider,
  type SlashAutocompleteCommand,
} from '../../components/editor/file-mention-provider';
import type { TUIState } from '../../tui-state';

/** Host surface required by slash-command autocomplete wiring. */
export interface AutocompleteHost {
  state: TUIState;
  fdPath: string | null;
}

/**
 * Static slash-command and workspace file-mention autocomplete wiring.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class AutocompleteController {
  constructor(private readonly host: AutocompleteHost) {}

  getSlashCommands(mode: SlashCommandHelpMode = 'primary'): readonly LioraSlashCommand[] {
    const builtins = sortSlashCommands(getBuiltinSlashCommands());
    return slashCommandsForHelp(builtins, mode);
  }

  setupAutocomplete(): void {
    const { host } = this;
    const primaryCommands = this.getSlashCommands('primary');
    const advancedCommands = this.getSlashCommands('advanced');
    const slashCommands: SlashAutocompleteCommand[] = [
      ...primaryCommands,
      ...advancedCommands,
    ].map((cmd) => {
      const completer =
        cmd.name === 'thinking'
          ? (prefix: string) =>
              thinkingArgumentCompletionsForModel(
                prefix,
                host.state.appState.availableModels[host.state.appState.model],
              )
          : cmd.name === 'job'
            ? (prefix: string) =>
                jobArgumentCompletions(
                  prefix,
                  (host.state.appState.conductorJobs?.jobs ?? [])
                    .filter((job) => job.status === 'needs_user')
                    .map((job) => shortJobId(job.id)),
                )
            : cmd.completeArgs;
      return {
        name: cmd.name,
        aliases: cmd.aliases,
        description: cmd.description,
        visibility: cmd.visibility ?? 'primary',
        ...(cmd.argumentHint !== undefined ? { argumentHint: cmd.argumentHint } : {}),
        ...(completer !== undefined
          ? { getArgumentCompletions: (prefix: string) => completer(prefix) }
          : {}),
      };
    });
    const provider = new FileMentionProvider(
      slashCommands,
      host.state.appState.workDir,
      host.fdPath,
      host.state.appState.additionalDirs,
      () => host.state.appState.inputMode,
    );
    host.state.editor.setAutocompleteProvider(provider);

    const argumentHints = new Map<string, string>();
    for (const cmd of slashCommands) {
      if (cmd.argumentHint === undefined) continue;
      argumentHints.set(cmd.name, cmd.argumentHint);
      for (const alias of cmd.aliases ?? []) {
        argumentHints.set(alias, cmd.argumentHint);
      }
    }
    host.state.editor.setArgumentHints(argumentHints);
  }

  refreshSlashCommandAutocomplete(): void {
    this.setupAutocomplete();
  }
}
