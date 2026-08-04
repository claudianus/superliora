---
"@superliora/liora": patch
---

Remove Ops Theatre (`/ops`, aliases `/ops-theatre` and `/monitor`): drop the live
4-pane ops panel, its Settings pane, keymap hints, visual-smoke segment, and the
PREMIUM §7.4 dopamine-ops spec. `/fleet` and the footer cache streak stay; panels
that pointed at `/ops` (cache, search, security, mission, never-halt, keybindings,
bench) now reference the surfaces that remain.
