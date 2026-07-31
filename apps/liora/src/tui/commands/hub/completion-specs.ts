/**
 * Slash command argument completion specs and functions.
 * Extracted from registry.ts — each command's autocompletion logic lives here.
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'pathe';

import type { AutocompleteItem } from '#/tui/renderer';

import { completeLeadingArg, type ArgCompletionSpec } from './complete-args';
import { improveHarnessArgumentCompletions } from '../improve-harness';
import { PERSONA_PRESET_DESCRIPTIONS, PERSONA_PRESET_NAMES } from '../persona';
import { pluginsArgumentCompletions } from '../plugins/plugins';
import { rendererArgumentCompletions } from '../renderer';
import { transcriptArgumentCompletions } from '../session/transcript';
import type { SlashCommandAvailability } from '../types';

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
  { value: 'talk', description: 'Open a War Room expert transcript / message panel' },
  { value: 'msg', description: 'Send a direct message to a War Room expert' },
  { value: 'pause', description: 'Pause the active Fleet war room' },
  { value: 'restaff', description: 'Request restaff on the active Fleet' },
  { value: 'raw', description: 'Toggle raw vs humanized team feed' },
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

const PREMIUM_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Enable Visual Quality (motion/density)' },
  { value: 'off', description: 'Disable Visual Quality' },
  { value: 'status', description: 'Show Visual Quality status' },
];

const CONTEXT_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'economy', description: 'Smallest working set (compact sooner)' },
  { value: 'balanced', description: 'Default working-set balance' },
  { value: 'deep', description: 'Larger working set for long tasks' },
  { value: 'full', description: 'Maximum working set before compaction' },
  { value: 'status', description: 'Show current working-set preset' },
];

const LOOP_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'List active conversation loops' },
  { value: 'stop', description: 'Stop a conversation loop (optional id)' },
];

const CRON_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'List scheduled cron jobs' },
  { value: 'delete', description: 'Delete a cron job by id' },
  { value: 'help', description: 'Show /cron usage' },
];

const EXTENSIONS_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'plugins', description: 'Open the plugins tab' },
  { value: 'hooks', description: 'Open the hooks tab' },
  { value: 'skills', description: 'Open the skills tab' },
  { value: 'mcp', description: 'Open the MCP tab' },
  { value: 'claude', description: 'Import from Claude allowlist inventory' },
  { value: 'import-claude', description: 'Import from Claude allowlist inventory' },
  { value: 'import', description: 'Import from Claude allowlist inventory' },
];

const ULTRAGOAL_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'replace', description: 'Replace the active CreateGoal objective' },
  { value: '--loop', description: 'Open self-improvement loop with circuit breaker' },
];

const TOGGLE_ON_OFF_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'on', description: 'Enable this mode' },
  { value: 'off', description: 'Disable this mode' },
];

const PERMISSION_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'manual', description: 'Prompt for every tool call' },
  { value: 'auto', description: 'Auto-approve safe tool calls' },
  { value: 'yolo', description: 'Auto-approve all tool calls' },
];

const THEME_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'auto', description: 'Follow terminal light/dark detection' },
  { value: 'dark', description: 'Force the dark built-in theme' },
  { value: 'light', description: 'Force the light built-in theme' },
  { value: 'import', description: 'Import a theme from path/url/github' },
];

const APPEARANCE_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'profile', description: 'Motion/profile preset (auto|off|subtle|premium)' },
  { value: 'density', description: 'Spacing density (auto|compact|comfortable|spacious)' },
  { value: 'timestamps', description: 'Show timestamps (on|off)' },
  { value: 'particles', description: 'Particle style (auto|off|ambient|events|premium)' },
  { value: 'animation-fps', description: 'Animation FPS (1-60)' },
  { value: 'canvas-background', description: 'Canvas background (on|off)' },
  { value: 'terminal-background', description: 'Terminal background (off|session)' },
  { value: 'terminal-palette', description: 'Terminal palette (on|off)' },
  { value: 'help', description: 'Show appearance usage' },
];

/** Fixed second-token values for `/appearance <key> <value>`. Free numbers (fps) stay open. */
const APPEARANCE_VALUE_COMPLETIONS: Readonly<
  Record<string, readonly ArgCompletionSpec[]>
> = {
  profile: [
    { value: 'auto', description: 'Follow terminal / default motion profile' },
    { value: 'off', description: 'Disable motion profile effects' },
    { value: 'subtle', description: 'Low-motion subtle profile' },
    { value: 'premium', description: 'Full premium motion profile' },
  ],
  density: [
    { value: 'auto', description: 'Follow default spacing density' },
    { value: 'compact', description: 'Tighter spacing' },
    { value: 'comfortable', description: 'Default comfortable spacing' },
    { value: 'spacious', description: 'Roomier spacing' },
  ],
  timestamps: [
    { value: 'on', description: 'Show message timestamps' },
    { value: 'off', description: 'Hide message timestamps' },
  ],
  particles: [
    { value: 'auto', description: 'Follow default particle style' },
    { value: 'off', description: 'Disable particles' },
    { value: 'ambient', description: 'Ambient particle style' },
    { value: 'events', description: 'Event-driven particles' },
    { value: 'premium', description: 'Premium particle style' },
  ],
  'canvas-background': [
    { value: 'on', description: 'Enable canvas background' },
    { value: 'off', description: 'Disable canvas background' },
  ],
  'terminal-background': [
    { value: 'off', description: 'No terminal background tint' },
    { value: 'session', description: 'Session-tinted terminal background' },
  ],
  'terminal-palette': [
    { value: 'on', description: 'Apply terminal palette overrides' },
    { value: 'off', description: 'Use the stock terminal palette' },
  ],
};

const PREFLIGHT_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: '--query=', description: 'Override Liora Recall readiness query' },
];

const EDITOR_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'code --wait', description: 'VS Code (code --wait)' },
  { value: 'vim', description: 'Vim' },
  { value: 'nvim', description: 'Neovim' },
  { value: 'nano', description: 'Nano' },
];

const ULTRAWORK_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'replace', description: 'Replace the current Mission objective' },
];

const HELP_PRIMARY_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'advanced', description: 'Show steering controls' },
];

const ADD_DIR_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'Show configured additional workspace directories' },
];

const PERSONA_SET_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = PERSONA_PRESET_NAMES.map(
  (name) => ({
    value: name,
    description: PERSONA_PRESET_DESCRIPTIONS[name],
  }),
);

/** Subcommands first, then bare preset shortcuts accepted by the handler. */
const PERSONA_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = [
  { value: 'list', description: 'List available presets' },
  { value: 'set', description: 'Apply a preset persona' },
  { value: 'name', description: 'Set a display name' },
  { value: 'tone', description: 'Set response tone' },
  { value: 'personality', description: 'Set personality traits' },
  { value: 'instructions', description: 'Add free-form instructions' },
  { value: 'clear', description: 'Remove persona customization' },
  { value: 'help', description: 'Show persona command help' },
  ...PERSONA_SET_ARG_COMPLETIONS,
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

/** War Room controls stay usable while a swarm turn is streaming. */
export function swarmControlAvailability(args: string): SlashCommandAvailability {
  const head = args.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  switch (head) {
    case 'on':
    case 'off':
    case 'talk':
    case 'msg':
    case 'message':
    case 'pause':
    case 'restaff':
    case 'raw':
      return 'always';
    default:
      return 'idle-only';
  }
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

export function thinkingCompletionSpecsForModel(
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

export function premiumArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(PREMIUM_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/context` working-set command. */
export function contextArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(CONTEXT_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/loop` list/stop subcommands. */
export function loopArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(LOOP_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/cron` list/delete/help subcommands. */
export function cronArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(CRON_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for `/extensions` tabs and Claude import shortcuts. */
export function extensionsArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  return completeLeadingArg(EXTENSIONS_ARG_COMPLETIONS, argumentPrefix);
}

/**
 * Completions for `/ultragoal`.
 * First token: `replace` / `--loop`. Second token after `replace`: `--loop`
 * (handler parses replace first, then --loop). Free-form objectives stay unclobbered.
 */
export function ultragoalArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const replaceThenLoop = argumentPrefix.match(/^replace\s+(\S*)$/i);
  if (replaceThenLoop !== null) {
    const valuePrefix = replaceThenLoop[1] ?? '';
    return (
      completeLeadingArg(
        [{ value: '--loop', description: 'Open self-improvement loop with circuit breaker' }],
        valuePrefix,
      )?.map((item) => ({
        ...item,
        value: `replace ${item.value}`,
      })) ?? null
    );
  }
  return completeLeadingArg(ULTRAGOAL_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for toggle commands that accept `on` / `off`. */
export function toggleOnOffArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  return completeLeadingArg(TOGGLE_ON_OFF_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for `/permission` modes. */
export function permissionArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  return completeLeadingArg(PERMISSION_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for `/theme` built-ins and import. */
export function themeArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(THEME_ARG_COMPLETIONS, argumentPrefix);
}

/**
 * Completions for `/appearance`.
 * First token: preference keys. Second token: fixed values for that key
 * (`profile premium`, `density compact`, …). Free-form values like
 * `animation-fps 45` stay unclobbered (no second-token menu).
 */
export function appearanceArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  const valueMatch = argumentPrefix.match(/^(\S+)\s+(\S*)$/i);
  if (valueMatch !== null) {
    const key = (valueMatch[1] ?? '').toLowerCase();
    const valuePrefix = valueMatch[2] ?? '';
    const specs = APPEARANCE_VALUE_COMPLETIONS[key];
    if (specs === undefined) return null;
    return (
      completeLeadingArg(specs, valuePrefix)?.map((item) => ({
        ...item,
        value: `${key} ${item.value}`,
      })) ?? null
    );
  }
  return completeLeadingArg(APPEARANCE_ARG_COMPLETIONS, argumentPrefix);
}

/**
 * Leading-arg completions for `/preflight`.
 * Completes the fixed `--query=` flag while the user is still on the first
 * token so free-form evidence paths remain unclobbered.
 */
export function preflightArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  return completeLeadingArg(PREFLIGHT_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for common `/editor` external editors. */
export function editorArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeLeadingArg(EDITOR_ARG_COMPLETIONS, argumentPrefix);
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

/**
 * Completions for `/persona`.
 * First token: subcommands. Second token for `set`/`preset`: fixed preset names
 * so free-form name/tone/instructions text is never clobbered.
 */
export function personaArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const setMatch = argumentPrefix.match(/^(set|preset)\s+(\S*)$/i);
  if (setMatch !== null) {
    const verb = (setMatch[1] ?? 'set').toLowerCase();
    const valuePrefix = setMatch[2] ?? '';
    return (
      completeLeadingArg(PERSONA_SET_ARG_COMPLETIONS, valuePrefix)?.map((item) => ({
        ...item,
        value: `${verb} ${item.value}`,
      })) ?? null
    );
  }
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

export { profileArgumentCompletions } from '../config/harness/agent-profile';
