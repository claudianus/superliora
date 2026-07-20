import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'pathe';

import type { AutocompleteItem } from '#/tui/renderer';

import { completeLeadingArg, type ArgCompletionSpec } from './complete-args';
import { rendererArgumentCompletions } from './renderer';
import type { LioraSlashCommand, SlashCommandAvailability, SlashCommandVisibility } from './types';

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

const THINKING_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'off', description: 'Disable thinking' },
  { value: 'on', description: 'Enable the default effort' },
  { value: 'low', description: 'Use low thinking effort' },
  { value: 'medium', description: 'Use medium thinking effort' },
  { value: 'high', description: 'Use high thinking effort' },
  { value: 'xhigh', description: 'Use extra-high thinking effort' },
  { value: 'max', description: 'Use maximum thinking effort' },
];

export interface ThinkingCompletionModel {
  readonly capabilities?: readonly string[];
  readonly adaptiveThinking?: boolean;
  readonly supportEfforts?: readonly string[];
}

const PLAN_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Enable free-form plan mode' },
  { value: 'off', description: 'Disable plan mode' },
  { value: 'clear', description: 'Clear current plan' },
];

const ULTRAWORK_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'replace', description: 'Replace the current Ultrawork objective' },
];

const HELP_PRIMARY_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'advanced', description: 'Show steering controls' },
];

const ADD_DIR_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'Show configured additional workspace directories' },
];

const PERSONA_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'List available presets' },
  { value: 'set', description: 'Apply a preset persona' },
  { value: 'name', description: 'Set a display name' },
  { value: 'tone', description: 'Set response tone' },
  { value: 'personality', description: 'Set personality traits' },
  { value: 'instructions', description: 'Add free-form instructions' },
  { value: 'clear', description: 'Remove persona customization' },
  { value: 'help', description: 'Show persona command help' },
];

const MEMORY_PRIMARY_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'stats', description: 'Show Liora Recall memory stats' },
  { value: 'list', description: 'List recent memories' },
  { value: 'search', description: 'Search memories' },
  { value: 'wiki', description: 'Show project-local LLM Wiki status' },
  { value: 'verify', description: 'Promote LLM Wiki and knowledge-map seed evidence to verified' },
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

export function thinkingArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(THINKING_ARG_COMPLETIONS, argumentPrefix);
}

export function thinkingArgumentCompletionsForModel(
  argumentPrefix: string,
  model: ThinkingCompletionModel | undefined,
): AutocompleteItem[] | null {
  const completions = thinkingCompletionSpecsForModel(model);
  return completeLeadingArg(completions, argumentPrefix);
}

function thinkingCompletionSpecsForModel(
  model: ThinkingCompletionModel | undefined,
): readonly ArgCompletionSpec[] {
  if (model === undefined) return THINKING_ARG_COMPLETIONS;
  const caps = new Set((model.capabilities ?? []).map((cap) => cap.trim().toLowerCase()));
  const alwaysThinking = caps.has('always_thinking');
  const supportsThinking =
    alwaysThinking || caps.has('thinking') || model.adaptiveThinking === true;
  if (!supportsThinking) {
    return THINKING_ARG_COMPLETIONS.filter((item) => item.value === 'off');
  }

  const supportEfforts = model.supportEfforts?.map((effort) => effort.trim().toLowerCase());
  const supported =
    supportEfforts === undefined || supportEfforts.length === 0
      ? undefined
      : new Set(supportEfforts);
  return THINKING_ARG_COMPLETIONS.filter((item) => {
    if (item.value === 'off') return !alwaysThinking;
    if (item.value === 'on') return true;
    return supported === undefined || supported.has(item.value);
  });
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

/** Argument autocompletion for the `/persona` command. */
export function personaArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(PERSONA_ARG_COMPLETIONS, argumentPrefix);
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
    name: 'premium',
    aliases: ['pq'],
    description: 'Toggle Premium Quality mode (visual-first premium harness)',
    priority: 100,
    argumentHint: '[on|off|status]',
    availability: 'always',
  },
  {
    name: 'plan',
    aliases: [],
    description: 'Free-form plan: model writes a plan file, you approve (interview → write)',
    priority: 80,
    argumentHint: '[on|off|clear]',
    completeArgs: planArgumentCompletions,
    availability: (args) => (args.trim().toLowerCase() === 'clear' ? 'idle-only' : 'always'),
  },
  {
    name: 'swarm',
    aliases: [],
    description: 'Parallel delegation: send task to specialist subagents (model decides split)',
    priority: 80,
    argumentHint: '[on|off] | <task>',
    completeArgs: swarmArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'ultrawork',
    aliases: ['uw'],
    description: 'Run Ultrawork: UltraPlan interview, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn',
    priority: 100,
    visibility: 'advanced',
    argumentHint: '[replace] <objective>',
    completeArgs: ultraworkArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'ultragoal',
    aliases: ['ug'],
    description: 'Structured loop goal: closed (AC verification) or open (--loop self-improvement with circuit breaker)',
    priority: 100,
    visibility: 'advanced',
    argumentHint: '[replace] [--loop] <objective>',
    availability: 'idle-only',
  },
  {
    name: 'ultraswarm',
    aliases: ['us'],
    description: 'Specialist delegation: lane analysis, coverage matrix, ENGAGE/DEFER decision',
    priority: 100,
    visibility: 'advanced',
    argumentHint: '[on|off] | <task>',
    completeArgs: swarmArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'ultraplan',
    aliases: ['up'],
    description: 'Structured plan pipeline: research → interview → design → review → write with gap analysis',
    priority: 100,
    visibility: 'advanced',
    argumentHint: '[objective]',
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
    name: 'thinking',
    aliases: ['think', 'reasoning', 'effort', 'depth'],
    description: 'Set thinking effort for the current session',
    priority: 100,
    argumentHint: '[off|on|low|medium|high|xhigh|max]',
    completeArgs: thinkingArgumentCompletions,
    availability: 'idle-only',
  },
  {
    name: 'btw',
    aliases: [],
    description: 'Ask a forked side agent a question',
    priority: 90,
    availability: 'always',
  },
  {
    name: 'bench',
    aliases: [],
    description: 'Show local SuperLiora benchmark diagnostics',
    priority: 80,
    visibility: 'diagnostic',
    argumentHint: '[evidence-path]',
    availability: 'always',
  },
  {
    name: 'preflight',
    aliases: ['pf'],
    description: 'Show SuperLiora harness preflight diagnostics',
    priority: 80,
    visibility: 'diagnostic',
    argumentHint: '[bench-evidence-path] [--query=<recall query>]',
    availability: 'always',
  },
  {
    name: 'renderer',
    aliases: ['render'],
    description: 'Inspect and control the native renderer',
    priority: 80,
    visibility: 'diagnostic',
    argumentHint: 'diagnostics [on|off|toggle|status] | trace [status|reset|export]',
    completeArgs: rendererArgumentCompletions,
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
    name: 'term',
    aliases: ['terminal'],
    description: 'Show detected terminal capabilities',
    priority: 62,
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
    description: 'Manage Liora Recall long-term memory',
    priority: 60,
    availability: 'always',
    argumentHint: '[stats|list|search|wiki|remember|forget|consolidate]',
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
    description: 'Simple goal loop: set objective, agent iterates until done (Ralph Loop)',
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
    name: 'quota',
    aliases: [],
    description: 'Show live provider subscription quotas and API credits',
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
    name: 'diff',
    aliases: [],
    description: 'Show working-tree changes as a review panel',
    priority: 85,
    argumentHint: '[path]',
    availability: 'always',
  },
  {
    name: 'files',
    aliases: ['tree', 'explorer'],
    description: 'Browse project files (git-aware)',
    priority: 84,
    availability: 'always',
  },
  {
    name: 'search',
    aliases: ['grep'],
    description: 'Search project file contents',
    priority: 83,
    argumentHint: '<pattern>',
    availability: 'always',
  },
  {
    name: 'aquarium',
    aliases: ['tank'],
    description: 'Overlay a Welcome-sized Jewel Tank (covers chat until the next message)',
    priority: 70,
    availability: 'always',
  },
  {
    name: 'upgrade',
    aliases: ['update'],
    description: 'Check for SuperLiora updates and install',
    priority: 90,
    availability: 'always',
  },
  {
    name: 'context',
    aliases: ['context-os', 'ctx'],
    description: 'Diagnose Context OS continuity/evidence + privacy (ZDR) posture',
    priority: 85,
    argumentHint: '[query]',
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
    name: 'retry',
    aliases: [],
    description: 'Resend your last message (same as Ctrl-Y)',
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
    name: 'appearance',
    aliases: ['skin'],
    description: 'Tune TUI motion, density, and background',
    priority: 60,
    availability: 'always',
  },
  {
    name: 'persona',
    aliases: ['character'],
    description: 'Customize agent personality, tone, and response style',
    priority: 60,
    argumentHint: '[list|set|name|tone|personality|instructions|clear|help]',
    completeArgs: personaArgumentCompletions,
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
    name: 'accounts',
    aliases: [],
    description: 'Manage OAuth account pools (promote, label, remove)',
    priority: 40,
    availability: 'always',
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
] as const satisfies readonly LioraSlashCommand[];

export type BuiltinSlashCommand = (typeof BUILTIN_SLASH_COMMANDS)[number];
export type BuiltinSlashCommandName = BuiltinSlashCommand['name'];

export function findBuiltInSlashCommand(commandName: string): BuiltinSlashCommand | undefined {
  const commands = BUILTIN_SLASH_COMMANDS as readonly LioraSlashCommand<BuiltinSlashCommandName>[];
  return commands.find(
    (command) =>
      command.name === commandName ||
      command.aliases.includes(commandName) ||
      (command.hiddenAliases?.includes(commandName) ?? false),
  ) as BuiltinSlashCommand | undefined;
}

export function resolveSlashCommandAvailability(
  command: LioraSlashCommand,
  args: string,
): SlashCommandAvailability {
  const availability = command.availability ?? 'idle-only';
  return typeof availability === 'function' ? availability(args) : availability;
}

export function sortSlashCommands(commands: readonly LioraSlashCommand[]): LioraSlashCommand[] {
  return [...commands].toSorted(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
  );
}

export type SlashCommandHelpMode = 'primary' | 'advanced' | 'diagnostics';

export function slashCommandsForHelp(
  commands: readonly LioraSlashCommand[],
  mode: SlashCommandHelpMode,
): LioraSlashCommand[] {
  const visibility: SlashCommandVisibility = mode === 'diagnostics' ? 'diagnostic' : mode;
  return commands.filter((command) => (command.visibility ?? 'primary') === visibility);
}
