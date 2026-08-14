/**
 * Single source of truth for TUI keyboard shortcuts.
 * Footer tips, Hub cheatsheet, and /help consume this list — do not fork key copy elsewhere.
 * Descriptions resolve via `ttui(descriptionKey)` at render time.
 */

import { primaryModLabel } from '#/tui/renderer';
import { ttui } from '#/tui/utils/tui-i18n';

/** Footer/help chord for the OS primary modifier (Cmd on darwin, Ctrl elsewhere). */
export function primaryChord(key: string, platform: NodeJS.Platform = process.platform): string {
  return `${primaryModLabel(platform)}-${key}`;
}

export type KeymapSurface = 'always' | 'idle' | 'streaming' | 'cheatsheet';

export interface KeymapBinding {
  readonly id: string;
  /** Display label, e.g. "Ctrl-K", "?" */
  readonly key: string;
  /** i18n key under `tui.help.shortcut.*` (or any catalog key). */
  readonly descriptionKey: string;
  /** When the binding applies / where it is listed. */
  readonly surface: KeymapSurface;
  readonly category: 'menu' | 'edit' | 'session' | 'navigate' | 'agent';
  /** Slash commands this binding supports (Settings glance + docs). */
  readonly relatedSlash?: readonly string[];
}

/** Resolved binding with localized description for display. */
export interface ResolvedKeymapBinding extends Omit<KeymapBinding, 'descriptionKey'> {
  readonly description: string;
}

export function resolveKeymapBinding(binding: KeymapBinding): ResolvedKeymapBinding {
  return {
    id: binding.id,
    key: binding.key,
    description: ttui(binding.descriptionKey),
    surface: binding.surface,
    category: binding.category,
    relatedSlash: binding.relatedSlash,
  };
}

/** Always-on bindings (any prompt state). */
export const KEYMAP_ALWAYS: readonly KeymapBinding[] = [
  {
    id: 'hub',
    key: primaryChord('K'),
    descriptionKey: 'tui.help.shortcut.hub',
    surface: 'always',
    category: 'menu',
  },
  {
    id: 'ask-mode',
    key: 'Shift-Tab',
    descriptionKey: 'tui.help.shortcut.shiftTab',
    surface: 'always',
    category: 'agent',
  },
  {
    id: 'escape',
    key: 'Esc',
    descriptionKey: 'tui.help.shortcut.esc',
    surface: 'always',
    category: 'edit',
  },
  {
    id: 'interrupt',
    key: primaryChord('C'),
    descriptionKey: 'tui.help.shortcut.ctrlC',
    surface: 'always',
    category: 'agent',
    relatedSlash: ['/plan', '/agents'],
  },
  {
    id: 'newline',
    key: 'Shift-Enter',
    descriptionKey: 'tui.help.shortcut.newline',
    surface: 'always',
    category: 'edit',
  },
  {
    id: 'submit',
    key: 'Enter',
    descriptionKey: 'tui.help.shortcut.enter',
    surface: 'always',
    category: 'edit',
  },
  {
    id: 'expand-tool-output',
    key: primaryChord('O'),
    descriptionKey: 'tui.help.shortcut.ctrlO',
    surface: 'always',
    category: 'navigate',
    relatedSlash: ['/transcript'],
  },
  {
    id: 'expand-todo',
    key: primaryChord('T'),
    descriptionKey: 'tui.help.shortcut.ctrlT',
    surface: 'always',
    category: 'navigate',
    relatedSlash: [],
  },
];

/** Idle-only bindings (not while a turn is streaming). */
export const KEYMAP_IDLE: readonly KeymapBinding[] = [
  {
    id: 'hub-question',
    key: '?',
    descriptionKey: 'tui.help.shortcut.hubQuestion',
    surface: 'idle',
    category: 'menu',
  },
  {
    id: 'history',
    key: primaryChord('R'),
    descriptionKey: 'tui.help.shortcut.history',
    surface: 'idle',
    category: 'edit',
  },
  {
    id: 'transcript-search',
    key: primaryChord('F'),
    descriptionKey: 'tui.help.shortcut.transcriptSearch',
    surface: 'idle',
    category: 'navigate',
  },
  {
    id: 'stash',
    key: primaryChord('X'),
    descriptionKey: 'tui.help.shortcut.ctrlX',
    surface: 'idle',
    category: 'edit',
  },
  {
    id: 'external-editor',
    key: primaryChord('G'),
    descriptionKey: 'tui.help.shortcut.ctrlG',
    surface: 'idle',
    category: 'edit',
  },
  {
    id: 'job-deck',
    key: 'Alt+J',
    descriptionKey: 'tui.help.shortcut.jobDeck',
    surface: 'idle',
    category: 'navigate',
    relatedSlash: ['/jobs'],
  },
  {
    id: 'job-inbox',
    key: 'Alt+I',
    descriptionKey: 'tui.help.shortcut.jobInbox',
    surface: 'idle',
    category: 'navigate',
    relatedSlash: ['/job'],
  },
  {
    id: 'intent-composer',
    key: 'Alt+B',
    descriptionKey: 'tui.help.shortcut.intentComposer',
    surface: 'idle',
    category: 'edit',
  },
];

/** Streaming-only bindings. */
export const KEYMAP_STREAMING: readonly KeymapBinding[] = [
  {
    id: 'steer',
    key: primaryChord('S'),
    descriptionKey: 'tui.help.shortcut.ctrlS',
    surface: 'streaming',
    category: 'agent',
    relatedSlash: ['/plan', '/agents'],
  },
  {
    id: 'background',
    key: primaryChord('B'),
    descriptionKey: 'tui.help.shortcut.ctrlB',
    surface: 'streaming',
    category: 'agent',
    relatedSlash: ['/jobs', '/agents'],
  },
];

/**
 * Full cheatsheet shown in Hub → Shortcuts and /help advanced.
 * Order: always → idle → streaming.
 */
export const KEYMAP_ALL: readonly KeymapBinding[] = [
  ...KEYMAP_ALWAYS,
  ...KEYMAP_IDLE,
  ...KEYMAP_STREAMING,
];

const FRONT_IDS = new Set([
  'hub',
  'hub-question',
  'escape',
  'interrupt',
  'steer',
]);

/** Compact beginner strip (Hub empty-state hints). */
export const KEYMAP_FRONT: readonly KeymapBinding[] = KEYMAP_ALL.filter((binding) =>
  FRONT_IDS.has(binding.id),
);

/** Convert keymap bindings into help-panel rows. */
export function keymapAsHelpShortcuts(): readonly { readonly keys: string; readonly description: string }[] {
  return KEYMAP_ALL.map((binding) => {
    const resolved = resolveKeymapBinding(binding);
    return {
      keys: resolved.key,
      description: resolved.description,
    };
  });
}

export function keymapFrontTips(): readonly {
  readonly key: string;
  readonly priority: number;
  readonly solo?: boolean;
}[] {
  return [
    { key: 'tui.tip.menuHub', priority: 8, solo: true },
    { key: 'tui.tip.ctrlK', priority: 5, solo: true },
  ];
}

export interface KeymapSurfaceCounts {
  readonly always: number;
  readonly idle: number;
  readonly streaming: number;
  readonly total: number;
}

/** Live binding counts per surface — Settings → Keybindings glance. */
export function keymapSurfaceCounts(): KeymapSurfaceCounts {
  return {
    always: KEYMAP_ALWAYS.length,
    idle: KEYMAP_IDLE.length,
    streaming: KEYMAP_STREAMING.length,
    total: KEYMAP_ALL.length,
  };
}

/** Bindings tagged for a slash command prefix (exact match on relatedSlash). */
export function keymapBindingsForSlash(slash: string): readonly KeymapBinding[] {
  return KEYMAP_ALL.filter((binding) => binding.relatedSlash?.includes(slash));
}

/** One-line sample for Settings / diagnostics panels. */
export function formatKeymapBindingSample(binding: KeymapBinding): string {
  const resolved = resolveKeymapBinding(binding);
  return `${resolved.key} — ${resolved.description} (${resolved.surface})`;
}
