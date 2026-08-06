/**
 * Single source of truth for TUI keyboard shortcuts.
 * Footer tips, Hub cheatsheet, and /help consume this list — do not fork key copy elsewhere.
 */

export type KeymapSurface = 'always' | 'idle' | 'streaming' | 'cheatsheet';

export interface KeymapBinding {
  readonly id: string;
  /** Display label, e.g. "Ctrl-K", "?" */
  readonly key: string;
  readonly description: string;
  /** When the binding applies / where it is listed. */
  readonly surface: KeymapSurface;
  readonly category: 'menu' | 'edit' | 'session' | 'navigate' | 'agent';
  /** Slash commands this binding supports (Settings glance + docs). */
  readonly relatedSlash?: readonly string[];
}

/** Always-on bindings (any prompt state). */
export const KEYMAP_ALWAYS: readonly KeymapBinding[] = [
  {
    id: 'hub',
    key: 'Ctrl-K',
    description: 'Open the Command Hub menu',
    surface: 'always',
    category: 'menu',
  },
  {
    id: 'escape',
    key: 'Esc',
    description: 'Cancel or close; press twice for session undo',
    surface: 'always',
    category: 'edit',
  },
  {
    id: 'interrupt',
    key: 'Ctrl-C',
    description: 'Stop the current turn (or confirm exit when idle)',
    surface: 'always',
    category: 'agent',
    relatedSlash: ['/mission', '/fleet'],
  },
  {
    id: 'newline',
    key: 'Shift-Enter',
    description: 'Insert a newline (Ctrl-J also works)',
    surface: 'always',
    category: 'edit',
  },
  {
    id: 'submit',
    key: 'Enter',
    description: 'Send the prompt',
    surface: 'always',
    category: 'edit',
  },
  {
    id: 'expand-tool-output',
    key: 'Ctrl-O',
    description: 'Cycle transcript density (minimal → compact → standard → full)',
    surface: 'always',
    category: 'navigate',
    relatedSlash: ['/transcript'],
  },
  {
    id: 'expand-todo',
    key: 'Ctrl-T',
    description: 'Expand or collapse the todo list',
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
    description: 'Open Command Hub (empty prompt)',
    surface: 'idle',
    category: 'menu',
  },
  {
    id: 'history',
    key: 'Ctrl-R',
    description: 'Search input history (empty prompt)',
    surface: 'idle',
    category: 'edit',
  },
  {
    id: 'transcript-search',
    key: 'Ctrl-F',
    description: 'Search the transcript',
    surface: 'idle',
    category: 'navigate',
  },
  {
    id: 'stash',
    key: 'Ctrl-X',
    description: 'Stash or restore the draft prompt',
    surface: 'idle',
    category: 'edit',
  },
  {
    id: 'external-editor',
    key: 'Ctrl-G',
    description: 'Open the external editor',
    surface: 'idle',
    category: 'edit',
  },
];

/** Streaming-only bindings. */
export const KEYMAP_STREAMING: readonly KeymapBinding[] = [
  {
    id: 'steer',
    key: 'Ctrl-S',
    description: 'Steer while a turn is running',
    surface: 'streaming',
    category: 'agent',
    relatedSlash: ['/mission', '/fleet'],
  },
  {
    id: 'background',
    key: 'Ctrl-B',
    description: 'Background the current work',
    surface: 'streaming',
    category: 'agent',
    relatedSlash: ['/fleet'],
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
  return KEYMAP_ALL.map((binding) => ({
    keys: binding.key,
    description: binding.description,
  }));
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
  return `${binding.key} — ${binding.description} (${binding.surface})`;
}
