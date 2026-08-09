/**
 * Slash command argument completion specs and functions.
 * Extracted from registry.ts — each command's autocompletion logic lives here.
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'pathe';

import type { AutocompleteItem } from '#/tui/renderer';

import { completeLeadingArg, type ArgCompletionSpec } from './complete-args';
import { PERSONA_PRESET_DESCRIPTIONS, PERSONA_PRESET_NAMES } from '../persona';
import { pluginsArgumentCompletions } from '../plugins/plugins';
import { transcriptArgumentCompletions } from '../session/transcript';
import type { SlashCommandAvailability } from '../types';
import { modelUsesEmbeddedThinkingEffort } from '#/tui/utils/model/thinking-effort';
import { ttui } from '#/tui/utils/tui-i18n';

interface ArgCompletionKeySpec {
  readonly value: string;
  readonly descriptionKey: string;
}

function arg(value: string, descriptionKey: string): ArgCompletionKeySpec {
  return { value, descriptionKey };
}

function resolveArgCompletions(specs: readonly ArgCompletionKeySpec[]): ArgCompletionSpec[] {
  return specs.map((spec) => ({ value: spec.value, description: ttui(spec.descriptionKey) }));
}

function completeI18n(
  specs: readonly ArgCompletionKeySpec[],
  argumentPrefix: string,
): ReturnType<typeof completeLeadingArg> {
  return completeLeadingArg(resolveArgCompletions(specs), argumentPrefix);
}

/** Subcommands offered when autocompleting `/goal <…>`. */
const GOAL_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('status', 'tui.slash.arg.goal.status'),
  arg('pause', 'tui.slash.arg.goal.pause'),
  arg('resume', 'tui.slash.arg.goal.resume'),
  arg('cancel', 'tui.slash.arg.goal.cancel'),
  arg('replace', 'tui.slash.arg.goal.replace'),
  arg('next', 'tui.slash.arg.goal.next'),
];

const GOAL_NEXT_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('manage', 'tui.slash.arg.goal.next.manage'),
];

const THINKING_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('off', 'tui.slash.arg.thinking.off'),
  arg('on', 'tui.slash.arg.thinking.on'),
  arg('low', 'tui.slash.arg.thinking.low'),
  arg('medium', 'tui.slash.arg.thinking.medium'),
  arg('high', 'tui.slash.arg.thinking.high'),
  arg('xhigh', 'tui.slash.arg.thinking.xhigh'),
  arg('max', 'tui.slash.arg.thinking.max'),
];

export interface ThinkingCompletionModel {
  readonly provider?: string;
  readonly capabilities?: readonly string[];
  readonly adaptiveThinking?: boolean;
  readonly supportEfforts?: readonly string[];
}

const PLAN_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('on', 'tui.slash.arg.plan.on'),
  arg('off', 'tui.slash.arg.plan.off'),
  arg('clear', 'tui.slash.arg.plan.clear'),
];

const ASK_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('on', 'tui.slash.arg.ask.on'),
  arg('off', 'tui.slash.arg.ask.off'),
];

const PREMIUM_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('on', 'tui.slash.arg.premium.on'),
  arg('off', 'tui.slash.arg.premium.off'),
  arg('status', 'tui.slash.arg.premium.status'),
];

const CONTEXT_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('economy', 'tui.slash.arg.context.economy'),
  arg('balanced', 'tui.slash.arg.context.balanced'),
  arg('deep', 'tui.slash.arg.context.deep'),
  arg('full', 'tui.slash.arg.context.full'),
  arg('status', 'tui.slash.arg.context.status'),
];

const LOOP_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('list', 'tui.slash.arg.loop.list'),
  arg('stop', 'tui.slash.arg.loop.stop'),
];

const CRON_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('list', 'tui.slash.arg.cron.list'),
  arg('delete', 'tui.slash.arg.cron.delete'),
  arg('help', 'tui.slash.arg.cron.help'),
];

const JOB_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('list', 'tui.slash.arg.job.list'),
  arg('board', 'tui.slash.arg.job.board'),
  arg('deck', 'tui.slash.arg.job.deck'),
  arg('monitor', 'tui.slash.arg.job.monitor'),
  arg('inbox', 'tui.slash.arg.job.inbox'),
  arg('answer', 'tui.slash.arg.job.answer'),
  arg('resume', 'tui.slash.arg.job.resume'),
  arg('cancel', 'tui.slash.arg.job.cancel'),
  arg('inspect', 'tui.slash.arg.job.inspect'),
  arg('schedule', 'tui.slash.arg.job.schedule'),
  arg('gc', 'tui.slash.arg.job.gc'),
  arg('mode', 'tui.slash.arg.job.mode'),
  arg('split-preview', 'tui.slash.arg.job.split-preview'),
  arg('help', 'tui.slash.arg.job.help'),
];

const EXTENSIONS_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('plugins', 'tui.slash.arg.extensions.plugins'),
  arg('hooks', 'tui.slash.arg.extensions.hooks'),
  arg('skills', 'tui.slash.arg.extensions.skills'),
  arg('mcp', 'tui.slash.arg.extensions.mcp'),
  arg('claude', 'tui.slash.arg.extensions.claude'),
  arg('import-claude', 'tui.slash.arg.extensions.import-claude'),
  arg('import', 'tui.slash.arg.extensions.import'),
];

const TOGGLE_ON_OFF_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('on', 'tui.slash.arg.toggle.on'),
  arg('off', 'tui.slash.arg.toggle.off'),
];

const PERMISSION_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('manual', 'tui.slash.arg.permission.manual'),
  arg('auto', 'tui.slash.arg.permission.auto'),
  arg('yolo', 'tui.slash.arg.permission.yolo'),
];

const THEME_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('auto', 'tui.slash.arg.theme.auto'),
  arg('dark', 'tui.slash.arg.theme.dark'),
  arg('light', 'tui.slash.arg.theme.light'),
  arg('import', 'tui.slash.arg.theme.import'),
];

const APPEARANCE_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('profile', 'tui.slash.arg.appearance.profile'),
  arg('density', 'tui.slash.arg.appearance.density'),
  arg('timestamps', 'tui.slash.arg.appearance.timestamps'),
  arg('particles', 'tui.slash.arg.appearance.particles'),
  arg('animation-fps', 'tui.slash.arg.appearance.animation-fps'),
  arg('canvas-background', 'tui.slash.arg.appearance.canvas-background'),
  arg('terminal-background', 'tui.slash.arg.appearance.terminal-background'),
  arg('terminal-palette', 'tui.slash.arg.appearance.terminal-palette'),
  arg('help', 'tui.slash.arg.appearance.help'),
];

/** Fixed second-token values for `/appearance <key> <value>`. Free numbers (fps) stay open. */
const APPEARANCE_VALUE_COMPLETIONS: Readonly<
  Record<string, readonly ArgCompletionKeySpec[]>
> = {
  profile: [
    arg('auto', 'tui.slash.arg.appearance.profile.auto'),
    arg('off', 'tui.slash.arg.appearance.profile.off'),
    arg('subtle', 'tui.slash.arg.appearance.profile.subtle'),
    arg('premium', 'tui.slash.arg.appearance.profile.premium'),
  ],
  density: [
    arg('auto', 'tui.slash.arg.appearance.density.auto'),
    arg('compact', 'tui.slash.arg.appearance.density.compact'),
    arg('comfortable', 'tui.slash.arg.appearance.density.comfortable'),
    arg('spacious', 'tui.slash.arg.appearance.density.spacious'),
  ],
  timestamps: [
    arg('on', 'tui.slash.arg.appearance.timestamps.on'),
    arg('off', 'tui.slash.arg.appearance.timestamps.off'),
  ],
  particles: [
    arg('auto', 'tui.slash.arg.appearance.particles.auto'),
    arg('off', 'tui.slash.arg.appearance.particles.off'),
    arg('ambient', 'tui.slash.arg.appearance.particles.ambient'),
    arg('events', 'tui.slash.arg.appearance.particles.events'),
    arg('premium', 'tui.slash.arg.appearance.particles.premium'),
  ],
  'canvas-background': [
    arg('on', 'tui.slash.arg.appearance.canvas-background.on'),
    arg('off', 'tui.slash.arg.appearance.canvas-background.off'),
  ],
  'terminal-background': [
    arg('off', 'tui.slash.arg.appearance.terminal-background.off'),
    arg('session', 'tui.slash.arg.appearance.terminal-background.session'),
  ],
  'terminal-palette': [
    arg('on', 'tui.slash.arg.appearance.terminal-palette.on'),
    arg('off', 'tui.slash.arg.appearance.terminal-palette.off'),
  ],
};

const EDITOR_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('code --wait', 'tui.slash.arg.editor.code-wait'),
  arg('vim', 'tui.slash.arg.editor.vim'),
  arg('nvim', 'tui.slash.arg.editor.nvim'),
  arg('nano', 'tui.slash.arg.editor.nano'),
];

const HELP_PRIMARY_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('advanced', 'tui.slash.arg.help.advanced'),
];

const ADD_DIR_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('list', 'tui.slash.arg.add-dir.list'),
];

const PERSONA_SET_ARG_COMPLETIONS: readonly ArgCompletionSpec[] = PERSONA_PRESET_NAMES.map(
  (name) => ({
    value: name,
    description: PERSONA_PRESET_DESCRIPTIONS[name] ?? name,
  }),
);

/** Subcommands first, then bare preset shortcuts accepted by the handler. */
const PERSONA_ARG_SUBCOMMAND_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('list', 'tui.slash.arg.persona.list'),
  arg('set', 'tui.slash.arg.persona.set'),
  arg('name', 'tui.slash.arg.persona.name'),
  arg('tone', 'tui.slash.arg.persona.tone'),
  arg('personality', 'tui.slash.arg.persona.personality'),
  arg('instructions', 'tui.slash.arg.persona.instructions'),
  arg('clear', 'tui.slash.arg.persona.clear'),
  arg('help', 'tui.slash.arg.persona.help'),
];

function personaPrimaryCompletions(): ArgCompletionSpec[] {
  return [...resolveArgCompletions(PERSONA_ARG_SUBCOMMAND_COMPLETIONS), ...PERSONA_SET_ARG_COMPLETIONS];
}

const MEMORY_PRIMARY_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('inspect', 'tui.slash.arg.memory.inspect'),
  arg('recall', 'tui.slash.arg.memory.recall'),
  arg('remember', 'tui.slash.arg.memory.remember'),
  arg('forget', 'tui.slash.arg.memory.forget'),
  arg('reflect', 'tui.slash.arg.memory.reflect'),
];

/** Argument autocompletion for the `/goal` command (subcommands). */
export function goalArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  const nextMatch = argumentPrefix.match(/^next\s+(\S*)$/i);
  if (nextMatch !== null) {
    return (
      completeI18n(GOAL_NEXT_ARG_COMPLETIONS, nextMatch[1] ?? '')?.map((item) => ({
        ...item,
        value: `next ${item.value}`,
      })) ?? null
    );
  }
  return completeI18n(GOAL_ARG_COMPLETIONS, argumentPrefix);
}

export function thinkingArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(THINKING_ARG_COMPLETIONS, argumentPrefix);
}

export function thinkingArgumentCompletionsForModel(
  argumentPrefix: string,
  model: ThinkingCompletionModel | undefined,
): AutocompleteItem[] | null {
  const completions = thinkingCompletionSpecsForModel(model);
  if (completions.length === 0) return [];
  return completeI18n(completions, argumentPrefix);
}

export function thinkingCompletionSpecsForModel(
  model: ThinkingCompletionModel | undefined,
): readonly ArgCompletionKeySpec[] {
  if (model === undefined) return THINKING_ARG_COMPLETIONS;
  if (modelUsesEmbeddedThinkingEffort(model)) return [];
  const caps = new Set((model.capabilities ?? []).map((cap) => cap.trim().toLowerCase()));
  const alwaysThinking = caps.has('always_thinking');
  const supportsThinking =
    alwaysThinking || caps.has('thinking') || model.adaptiveThinking === true;
  if (!supportsThinking) {
    return THINKING_ARG_COMPLETIONS.filter((item) => item.value === 'off');
  }

  const supportEfforts = model.supportEfforts?.map((effort) => effort.trim().toLowerCase());
  const supported =
    supportEfforts === undefined
      ? undefined
      : new Set(supportEfforts);
  return THINKING_ARG_COMPLETIONS.filter((item) => {
    if (item.value === 'off') return !alwaysThinking;
    if (item.value === 'on') return true;
    return supported === undefined || supported.has(item.value);
  });
}

export function askArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(ASK_ARG_COMPLETIONS, argumentPrefix);
}

export function planArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(PLAN_ARG_COMPLETIONS, argumentPrefix);
}

export function premiumArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(PREMIUM_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/context` working-set command. */
export function contextArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(CONTEXT_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/loop` list/stop subcommands. */
export function loopArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(LOOP_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/cron` list/delete/help subcommands. */
export function cronArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(CRON_ARG_COMPLETIONS, argumentPrefix);
}

const JOB_MODE_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('balanced', 'tui.slash.arg.job.mode.balanced'),
  arg('greenfield', 'tui.slash.arg.job.mode.greenfield'),
  arg('hotfix', 'tui.slash.arg.job.mode.hotfix'),
  arg('review', 'tui.slash.arg.job.mode.review'),
];

/**
 * When prefix is `answer <partial>`, optionally complete recent needs_user ids.
 */
export function jobArgumentCompletions(
  argumentPrefix: string,
  needsUserJobIds: readonly string[] = [],
): AutocompleteItem[] | null {
  const space = argumentPrefix.indexOf(' ');
  if (space === -1) {
    return completeI18n(JOB_ARG_COMPLETIONS, argumentPrefix);
  }
  const sub = argumentPrefix.slice(0, space).toLowerCase();
  const rest = argumentPrefix.slice(space + 1);
  if (sub === 'mode') {
    if (rest.includes(' ')) return null;
    return completeI18n(JOB_MODE_ARG_COMPLETIONS, rest);
  }
  if (sub !== 'answer' || rest.includes(' ') || needsUserJobIds.length === 0) {
    return null;
  }
  const lower = rest.toLowerCase();
  const items = needsUserJobIds
    .filter((id) => id.toLowerCase().startsWith(lower))
    .slice(0, 12)
    .map((id) => ({
      value: id,
      label: id,
      description: ttui('tui.slash.arg.job.answer.needs-user'),
    }));
  if (items.length === 1 && items[0]!.value.toLowerCase() === lower) return null;
  return items.length > 0 ? items : null;
}

const JOBS_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('board', 'tui.slash.arg.jobs.board'),
  arg('deck', 'tui.slash.arg.jobs.deck'),
  arg('monitor', 'tui.slash.arg.jobs.monitor'),
  arg('watch', 'tui.slash.arg.jobs.watch'),
];

/** Argument autocompletion for `/jobs` board/deck aliases. */
export function jobsArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(JOBS_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for `/extensions` tabs and Claude import shortcuts. */
export function extensionsArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  return completeI18n(EXTENSIONS_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for toggle commands that accept `on` / `off`. */
export function toggleOnOffArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  return completeI18n(TOGGLE_ON_OFF_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for `/permission` modes. */
export function permissionArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  return completeI18n(PERMISSION_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for `/theme` built-ins and import. */
export function themeArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(THEME_ARG_COMPLETIONS, argumentPrefix);
}

const LOCALE_ARG_COMPLETIONS: readonly ArgCompletionKeySpec[] = [
  arg('auto', 'tui.locale.option.autoDesc'),
  arg('en', 'tui.locale.option.enDesc'),
  arg('ko', 'tui.locale.option.koDesc'),
];

/** Leading-arg completions for `/locale` (`auto` / `en` / `ko`). */
export function localeArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(LOCALE_ARG_COMPLETIONS, argumentPrefix);
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
      completeI18n(specs, valuePrefix)?.map((item) => ({
        ...item,
        value: `${key} ${item.value}`,
      })) ?? null
    );
  }
  return completeI18n(APPEARANCE_ARG_COMPLETIONS, argumentPrefix);
}

/** Leading-arg completions for common `/editor` external editors. */
export function editorArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(EDITOR_ARG_COMPLETIONS, argumentPrefix);
}

export function helpArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(HELP_PRIMARY_ARG_COMPLETIONS, argumentPrefix);
}

/** Argument autocompletion for the `/add-dir` command. */
export function addDirArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  if (isPathLikeAddDirArgument(argumentPrefix)) {
    return completeAddDirPath(argumentPrefix);
  }
  return completeI18n(ADD_DIR_ARG_COMPLETIONS, argumentPrefix);
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
  return completeLeadingArg(personaPrimaryCompletions(), argumentPrefix);
}

export function memoryArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
  return completeI18n(MEMORY_PRIMARY_ARG_COMPLETIONS, argumentPrefix);
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
