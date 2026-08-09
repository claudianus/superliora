import type { Session } from '@superliora/sdk';

import {
  BUILTIN_SLASH_COMMANDS,
  buildPluginSlashCommands,
  buildSkillSlashCommands,
  isExperimentalFlagEnabled,
  jobArgumentCompletions,
  slashCommandsForHelp,
  sortSlashCommands,
  thinkingArgumentCompletionsForModel,
  type LioraSlashCommand,
  type SlashCommandHelpMode,
  type SkillListSession,
} from '../../commands';
import { shortJobId } from '../../components/job-board/job-board-helpers';
import {
  FileMentionProvider,
  type SlashAutocompleteCommand,
} from '../../components/editor/file-mention-provider';
import type { TUIState } from '../../tui-state';
import { loadSkillsState } from '#/utils/skills/skills-state';

/** Host surface required by slash-command autocomplete wiring. */
export interface AutocompleteHost {
  state: TUIState;
  session: Session | undefined;
  fdPath: string | null;
  skillCommands: LioraSlashCommand[];
  pluginCommands: LioraSlashCommand[];
  readonly skillCommandMap: Map<string, string>;
  readonly pluginCommandMap: Map<string, string>;
}

/**
 * Slash-command autocomplete and dynamic skill/plugin command refresh.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class AutocompleteController {
  constructor(private readonly host: AutocompleteHost) {}

  getSlashCommands(mode: SlashCommandHelpMode = 'primary'): readonly LioraSlashCommand[] {
    const builtins = sortSlashCommands(BUILTIN_SLASH_COMMANDS).filter((command) =>
      isExperimentalFlagEnabled(command.experimentalFlag),
    );
    const visibleBuiltins = slashCommandsForHelp(builtins, mode);
    return mode === 'diagnostics'
      ? visibleBuiltins
      : [...visibleBuiltins, ...this.host.skillCommands, ...this.host.pluginCommands];
  }

  setupAutocomplete(): void {
    const { host } = this;
    const primaryCommands = this.getSlashCommands('primary');
    const advancedCommands = this
      .getSlashCommands('advanced')
      .filter((cmd) => !host.skillCommands.includes(cmd) && !host.pluginCommands.includes(cmd));
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
      (query, signal) => this.searchSkillSlashCommands(query, signal),
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

  async refreshSkillCommands(session?: SkillListSession): Promise<void> {
    const { host } = this;
    if (session === undefined) {
      host.skillCommands = [];
      host.skillCommandMap.clear();
      this.setupAutocomplete();
      return;
    }

    let skills;
    try {
      skills = await session.listSkills();
    } catch {
      // Keep any previously loaded skills; still rebuild the provider so static
      // slash commands stay wired after a failed RPC.
      this.setupAutocomplete();
      return;
    }
    // Drop stale results if the active session rotated while listSkills was in flight.
    if (host.session !== undefined && session !== host.session) {
      this.setupAutocomplete();
      return;
    }

    const skillsState = await loadSkillsState();
    const disabledNames = new Set(skillsState.disabled);
    const skillCommands = buildSkillSlashCommands(skills, { disabledNames });
    // Cap the static slash menu so huge skill catalogs stay scannable; deeper
    // matches still arrive via dynamic `/skill:` search.
    const MAX_STATIC_SKILL_COMMANDS = 64;
    host.skillCommands = [...skillCommands.commands].slice(0, MAX_STATIC_SKILL_COMMANDS);
    host.skillCommandMap.clear();
    for (const [commandName, skillName] of skillCommands.commandMap) {
      if (host.skillCommands.some((cmd) => cmd.name === commandName)) {
        host.skillCommandMap.set(commandName, skillName);
      }
    }
    this.setupAutocomplete();
  }

  async refreshPluginCommands(session?: Session): Promise<void> {
    const { host } = this;
    host.pluginCommands = [];
    host.pluginCommandMap.clear();
    if (session === undefined) {
      this.setupAutocomplete();
      return;
    }

    let defs;
    try {
      defs = await session.listPluginCommands();
    } catch {
      this.setupAutocomplete();
      return;
    }
    if (host.session !== session) return;

    const pluginCommands = buildPluginSlashCommands(defs);
    host.pluginCommands = [...pluginCommands.commands];
    for (const [commandName, body] of pluginCommands.commandMap) {
      host.pluginCommandMap.set(commandName, body);
    }
    this.setupAutocomplete();
  }

  async refreshDynamicSlashCommands(session?: Session): Promise<void> {
    await this.refreshSkillCommands(session);
    await this.refreshPluginCommands(session);
  }

  private async searchSkillSlashCommands(
    query: string,
    signal: AbortSignal,
  ): Promise<readonly LioraSlashCommand[]> {
    const { host } = this;
    const session = host.session;
    if (session === undefined || signal.aborted) return [];
    const skillQuery = query.startsWith('skill:') ? query.slice('skill:'.length) : query;
    const trimmed = skillQuery.trim();
    let skills;
    try {
      // Bare `/skill:` (or whitespace-only) reuses listSkills so the menu can
      // surface activatable skills even when the static cache is still empty.
      skills =
        trimmed.length === 0
          ? await session.listSkills()
          : await session.searchSkills(trimmed, { limit: 12 });
    } catch {
      return [];
    }
    if (signal.aborted) return [];
    const skillsState = await loadSkillsState();
    const skillCommands = buildSkillSlashCommands(skills, {
      disabledNames: new Set(skillsState.disabled),
    });
    for (const [commandName, skillName] of skillCommands.commandMap) {
      host.skillCommandMap.set(commandName, skillName);
    }
    // Cap dynamic results so the autocomplete menu stays scannable.
    return skillCommands.commands.slice(0, 12);
  }
}
