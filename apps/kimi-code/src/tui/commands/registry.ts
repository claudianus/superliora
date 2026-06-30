import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'pathe';

import type { AutocompleteItem } from '@earendil-works/pi-tui';

import { completeLeadingArg, type ArgCompletionSpec } from './complete-args';
import type { KimiSlashCommand, SlashCommandAvailability, SlashCommandVisibility } from './types';

/** Subcommands offered when autocompleting `/goal <…>`. */
const GOAL_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'status', description: 'Show the current goal' },
  { value: 'pause', description: 'Pause the active goal' },
  { value: 'resume', description: 'Resume a paused goal' },
  { value: 'cancel', description: 'Cancel and remove the current goal' },
  { value: 'replace', description: 'Replace the current goal with a new objective' },
  { value: 'next', description: 'Queue an upcoming goal' },
];

const GOAL_NEXT_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'manage', description: 'Manage upcoming goals' },
];

const SWARM_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Turn team mode on' },
  { value: 'off', description: 'Turn team mode off' },
];

const PLAN_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Turn plan mode on' },
  { value: 'off', description: 'Turn plan mode off' },
  { value: 'ultra', description: 'Turn UltraPlan mode on' },
  { value: 'clear', description: 'Clear plan mode' },
];

const ULTRAWORK_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'replace', description: 'Replace the current UltraGoal' },
];

const HELP_PRIMARY_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'advanced', description: 'Show manual workflow commands' },
];

const ADD_DIR_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'Show configured additional workspace directories' },
];

const MEMORY_PRIMARY_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'stats', description: 'Show Kimi Recall memory stats' },
  { value: 'list', description: 'List recent memories' },
  { value: 'search', description: 'Search memories' },
  { value: 'remember', description: 'Write a memory' },
  { value: 'forget', description: 'Forget a memory by id' },
  { value: 'consolidate', description: 'Merge exact duplicate memories' },
];

/** Argument autocompletion for the `/goal` command (subcommands). */
export function goalArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const nextMatch = argumentPrefix.match(/^next\s+(\S*)$/i);
  if (nextMatch !== null) {
    return (
      completeLeadingArg(GOAL_NEXT_ARG_COMPLETIONS, nextMatch[1] ?? '')?.map((item) => ({
        ...item,
        value: `next ${item.value}`,
      })) ?? null
    );
  }
  return completeLeadingArg(GOAL_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/swarm` command (subcommands). */
export function swarmArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(SWARM_ARG_COMPLETIONS, argumentPrefix);
}

export function planArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(PLAN_ARG_COMPLETIONS, argumentPrefix);
}

export function ultraworkArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(ULTRAWORK_ARG_COMPLETIONS, argumentPrefix);
}

export function helpArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(HELP_PRIMARY_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/add-dir` command. */
export function addDirArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  if (isPathLikeAddDirArgument(argumentPrefix)) {
    return completeAddDirPath(argumentPrefix);
  }
  return completeLeadingArg(ADD_DIR_ARG_COMPLETIONS, argumentPrefix);
}

export function memoryArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(MEMORY_PRIMARY_ARG_COMPLETIONS, argumentPrefix);
}

function isPathLikeAddDirArgument(argumentPrefix: string): boolean {
  return argumentPrefix === '.' || argumentPrefix === '..' || argumentPrefix.startsWith('./') || argumentPrefix.startsWith('../') || argumentPrefix.startsWith('/') || argumentPrefix.startsWith('~');
}

function completeAddDirPath(argumentPrefix: string): AutocompleteItem[] | null {
  const normalizedPrefix = argumentPrefix === '~' ? '~/' : argumentPrefix;
  const expandedPrefix = expandHomePrefix(normalizedPrefix);
  const parentInput = getDirectoryCompletionParentInput(normalizedPrefix, expandedPrefix);
  const partialName = normalizedPrefix.endsWith('/') ? '' : basename(expandedPrefix);
  const parentDir = resolveDirectoryCompletionParent(parentInput);
  let entries;
  try {
    entries = readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const items: AutocompleteItem[] = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..' || entry.name.startsWith('.')) continue;
    if (partialName.length > 0 && !entry.name.toLowerCase().startsWith(partialName.toLowerCase())) continue;
    const absolutePath = join(parentDir, entry.name);
    if (!isDirectoryPath(absolutePath, entry.isDirectory(), entry.isSymbolicLink())) continue;
    const value = formatDirectoryCompletionValue(normalizedPrefix, parentInput, entry.name);
    items.push({
      value,
      label: `${entry.name}/`,
      description: absolutePath,
    });
  }

  return items.length > 0 ? items : null;
}

function expandHomePrefix(argumentPrefix: string): string {
  if (argumentPrefix === '~') return homedir();
  if (argumentPrefix.startsWith('~/')) return join(homedir(), argumentPrefix.slice(2));
  return argumentPrefix;
}

function getDirectoryCompletionParentInput(argumentPrefix: string, expandedPrefix: string): string {
  if (argumentPrefix === '/') return '/';
  if (argumentPrefix === '~/') return homedir();
  if (argumentPrefix.endsWith('/')) return expandedPrefix.slice(0, -1);
  return dirname(expandedPrefix);
}

function resolveDirectoryCompletionParent(parentInput: string): string {
  if (parentInput === '~') return homedir();
  if (parentInput.startsWith('~/')) return join(homedir(), parentInput.slice(2));
  return resolve(parentInput);
}

function isDirectoryPath(path: string, isDirectory: boolean, isSymlink: boolean): boolean {
  if (isDirectory) return true;
  if (!isSymlink) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function formatDirectoryCompletionValue(argumentPrefix: string, parentInput: string, entryName: string): string {
  if (argumentPrefix.startsWith('~/')) {
    const home = homedir();
    const homeRelative = relative(home, parentInput);
    return `~${homeRelative.length > 0 ? `/${homeRelative}` : ''}/${entryName}/`;
  }
  if (argumentPrefix.startsWith('/')) {
    return `${join(parentInput, entryName)}/`;
  }
  return `${join(parentInput, entryName)}/`;
}

export const BUILTIN_SLASH_COMMANDS = [
  {
    name: 'yolo',
    aliases: ['yes'],
    description: 'Toggle auto-approve mode',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'auto',
    aliases: [],
    description: 'Toggle auto permission mode',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'permission',
    aliases: [],
    description: 'Select permission mode',
    priority: 100,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'settings',
    aliases: ['config'],
    description: 'Open TUI settings',
    priority: 100,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'plan',
    aliases: [],
    description: 'Toggle plan mode',
    priority: 100,
    argumentHint: '[on|off|ultra|clear]',
    completeArgs: planArgumentCompletions,
    availability: (args) => (args.trim().toLowerCase() === 'clear' ? 'idle-only' : 'always'),
  },
  {
    name: 'swarm',
    aliases: [],
    description: 'Toggle specialist team mode or send one task',
    priority: 100,
    visibility: 'advanced',
    argumentHint: '[on|off] | <task>',
    completeArgs: swarmArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'ultraswarm',
    aliases: ['us'],
    description: 'Run a complex task with specialist agents',
    priority: 100,
    visibility: 'hidden',
    argumentHint: '<task description>',
    availability: 'idle-only',
  },
  {
    name: 'ultrawork',
    aliases: ['uw'],
    hiddenAliases: ['ultragoal', 'ug'],
    description: 'Start Ultrawork: auto-link UltraPlan, UltraGoal, UltraSwarm, Verify',
    priority: 100,
    visibility: 'advanced',
    argumentHint: '[replace] <objective>',
    completeArgs: ultraworkArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'model',
    aliases: [],
    description: 'Switch LLM model',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'provider',
    aliases: ['providers'],
    description: 'Manage AI providers (add / delete / refresh)',
    priority: 95,
    availability: 'always',
  },
  {
    name: 'btw',
    aliases: [],
    description: 'Ask a forked side agent a question',
    priority: 90,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'bench',
    aliases: [],
    description: 'Show local Super Kimi benchmark diagnostics',
    priority: 80,
    visibility: 'diagnostic',
    argumentHint: '[evidence-path]',
    availability: 'always',
  },
  {
    name: 'preflight',
    aliases: ['pf'],
    description: 'Show Super Kimi harness preflight diagnostics',
    priority: 80,
    visibility: 'diagnostic',
    argumentHint: '[bench-evidence-path] [--query=<recall query>]',
    availability: 'always',
  },
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands and shortcuts',
    priority: 80,
    completeArgs: helpArgumentCompletions,
    availability: 'always',
  },
  {
    name: 'new',
    aliases: ['clear'],
    description: 'Start a fresh session in the current workspace',
    priority: 80,
  },
  {
    name: 'sessions',
    aliases: ['resume'],
    description: 'Browse and resume sessions',
    priority: 80,
  },
  {
    name: 'tasks',
    aliases: ['task'],
    description: 'Browse background tasks',
    priority: 80,
    availability: 'always',
  },
  {
    name: 'mcp',
    aliases: [],
    description: 'Show MCP server status',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'plugins',
    aliases: [],
    description: 'Manage plugins',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'memory',
    aliases: ['recall'],
    description: 'Manage Kimi Recall long-term memory',
    priority: 60,
    availability: 'always',
    argumentHint: '[stats|list|search|remember|forget|consolidate]',
    completeArgs: memoryArgumentCompletions,
  },
  {
    name: 'add-dir',
    aliases: [],
    description: 'Add or list an additional workspace directory',
    priority: 60,
    availability: 'idle-only',
    argumentHint: '[list] | <path>',
    completeArgs: addDirArgumentCompletions,
  },
  {
    name: 'experiments',
    aliases: ['experimental'],
    description: 'Manage experimental features',
    priority: 60,
    visibility: 'advanced',
    availability: 'idle-only',
  },
  {
    name: 'reload',
    aliases: [],
    description: 'Reload session and apply config.toml settings plus tui.toml UI preferences',
    priority: 60,
    visibility: 'advanced',
    availability: 'idle-only',
  },
  {
    name: 'reload-tui',
    aliases: [],
    description: 'Reload only tui.toml UI preferences',
    priority: 60,
    visibility: 'advanced',
    availability: 'always',
  },
  {
    name: 'compact',
    aliases: [],
    description: 'Compact the conversation context',
    priority: 80,
    argumentHint: '<instruction>',
  },
  {
    name: 'goal',
    aliases: [],
    description: 'Keep long-running work organized across turns',
    priority: 80,
    argumentHint: '[status|pause|resume|cancel|replace|next] | <objective>',
    completeArgs: goalArgumentCompletions,
    // status / pause / cancel are always available; creation, replacement, and
    // resume start (or restart) a turn and so are idle-only.
    availability: (args) => {
      const trimmed = args.trim();
      if (trimmed === 'next' || trimmed.startsWith('next ')) return 'always';
      return trimmed === '' || trimmed === 'status' || trimmed === 'pause' || trimmed === 'cancel'
        ? 'always'
        : 'idle-only';
    },
  },
  {
    name: 'init',
    aliases: [],
    description: 'Analyze the codebase and generate AGENTS.md',
  },
  {
    name: 'fork',
    aliases: [],
    description: 'Fork the current session',
    priority: 80,
  },
  {
    name: 'title',
    aliases: ['rename'],
    description: 'Set or show session title',
    priority: 60,
    argumentHint: '<title>',
    availability: 'always',
  },
  {
    name: 'usage',
    aliases: [],
    description: 'Show session tokens + context window + plan quotas',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'status',
    aliases: [],
    description: 'Show current session and runtime status',
    priority: 100,
    availability: 'always',
  },
  {
    name: 'feedback',
    aliases: [],
    description: 'Send feedback to make Kimi Code better',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'undo',
    aliases: [],
    description: 'Withdraw the last prompt from the transcript',
    priority: 80,
    availability: 'idle-only',
  },
  {
    name: 'editor',
    aliases: [],
    description: 'Set the external editor for Ctrl-G',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'theme',
    aliases: [],
    description: 'Set the terminal UI theme',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'logout',
    aliases: ['disconnect'],
    description: 'Log out of a configured provider',
    priority: 40,
  },
  {
    name: 'login',
    aliases: [],
    description: 'Select a platform and authenticate',
    priority: 40,
  },
  {
    name: 'export-md',
    aliases: ['export'],
    description: 'Export current session as a Markdown file',
    priority: 40,
  },
  {
    name: 'export-debug-zip',
    aliases: [],
    description: 'Export current session as a debug ZIP archive',
    priority: 40,
    visibility: 'diagnostic',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the application',
    priority: 20,
  },
  {
    name: 'version',
    aliases: [],
    description: 'Show version information',
    priority: 20,
    availability: 'always',
  },
] as const satisfies readonly KimiSlashCommand[];

export type BuiltinSlashCommand = (typeof BUILTIN_SLASH_COMMANDS)[number];
export type BuiltinSlashCommandName = BuiltinSlashCommand['name'];

export function findBuiltInSlashCommand(commandName: string): BuiltinSlashCommand | undefined {
  const commands = BUILTIN_SLASH_COMMANDS as readonly KimiSlashCommand<BuiltinSlashCommandName>[];
  return commands.find(
    (command) =>
      command.name === commandName ||
      command.aliases.includes(commandName) ||
      (command.hiddenAliases?.includes(commandName) ?? false),
  ) as BuiltinSlashCommand | undefined;
}

export function resolveSlashCommandAvailability(
  command: KimiSlashCommand,
  args: string,
): SlashCommandAvailability {
  const availability = command.availability ?? 'idle-only';
  return typeof availability === 'function' ? availability(args) : availability;
}

export function sortSlashCommands(commands: readonly KimiSlashCommand[]): KimiSlashCommand[] {
  return [...commands].toSorted(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
  );
}

export type SlashCommandHelpMode = 'primary' | 'advanced' | 'diagnostics';

export function slashCommandsForHelp(
  commands: readonly KimiSlashCommand[],
  mode: SlashCommandHelpMode,
): KimiSlashCommand[] {
  const visibility: SlashCommandVisibility = mode === 'diagnostics' ? 'diagnostic' : mode;
  return commands.filter((command) => (command.visibility ?? 'primary') === visibility);
}
