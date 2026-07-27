/**
 * @deprecated Use `#/tui/keymap` — single source for live bindings and Hub cheatsheet.
 * Kept as a thin re-export so stale imports do not break.
 */

export {
  KEYMAP_ALL as DEFAULT_BINDINGS,
  KEYMAP_FRONT,
  KEYMAP_ALL,
  type KeymapBinding as KeyBinding,
} from '#/tui/keymap';
