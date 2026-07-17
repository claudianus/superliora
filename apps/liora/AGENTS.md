# apps/liora Development Guide

Local rules for `apps/liora`. Cross-repo gates: root `AGENTS.md`.

> **TUI work:** `.agents/skills/write-tui/SKILL.md` (architecture, placement, tests, theme, dialogs / `DESIGN.md`). This file is the map, boundaries, and CI-enforced hard rules only.

## Layout

Entry: `src/main.ts` → `src/cli/commands.ts` → `src/cli/run-shell.ts` → SDK `LioraHarness` → `src/tui/kimi-tui.ts`.

| Path | Role |
|---|---|
| `src/constant/` | Shared non-copy constants (product, paths, terminal, updates, …) |
| `src/cli/` | Args, subcommands, CLI startup |
| `src/tui/` | Interactive TUI |
| `src/tui/kimi-tui.ts` | `LioraTUI` coordinator — wire state/layout/editor/session/events/dialogs; heavy logic goes to `controllers/` |
| `src/tui/tui-state.ts` | `TUIState` / initial app state |
| `src/tui/controllers/` | Testable slices: session events, streaming UI, replay, tasks browser, editor keyboard, auth |
| `src/tui/commands/` | Slash commands |
| `src/tui/components/` | Native-renderer UI by kind (`chrome/`, `dialogs/`, `editor/`, `media/`, `messages/`, `panes/`) |
| `src/tui/renderer/` | Facade over `@harness-kit/tui-renderer` + local adapters. Import TUI primitives here, not the package directly. No `@earendil-works/pi-tui` (guarded). |
| `src/tui/constant/` | TUI-only constants |
| `src/tui/reverse-rpc/` | SDK approval/question ↔ UI |
| `src/tui/theme/` | Themes / tokens |
| `src/tui/utils/`, `src/utils/` | TUI-local vs app-wide helpers |

## Boundaries

- `cli` parses input and starts the app; no TUI interaction logic.
- `LioraTUI` coordinates; put testable work in `controllers`, `commands`, `components`, `reverse-rpc`, or `utils`.
- `components` are presentation/local interaction only — no direct SDK or session ownership.
- `reverse-rpc` adapts SDK request/response shapes for dialogs.
- `theme` owns colors/styles; no chalk named colors in components.
- `utils` must not depend on `TUIState` / component instances.
- App code uses `@superliora/sdk` only — **no** `@superliora/agent-core`.

## Hard rules (CI-guarded)

- In `handleInput(data)`, never compare printable keys with literals (`data === 'q'`). Kitty/CSI-u breaks that. Use `printableChar(data)` from `src/tui/utils/printable-key.ts`; function keys via `matchesKey` / `Key.*`; control chars (codepoint < 32) may use raw `data`. Guard: `test/tui/printable-key-guard.test.ts`.
- No chalk named colors in non-comment code (`chalk.red`, `chalk.cyan`, …). Prefer `chalk.hex(colors.<token>)` or `styles.*`. New semantics → add a `ColorPalette` field for dark and light. Light-theme text ≥ 4.5:1, large chrome ≥ 3:1. Do not cache styled chalk at module scope. Guard: `test/tui/chalk-named-color-guard.test.ts`.
- Constants live under `constant/`, not scattered in components.
- Prefer flat code over one-line wrappers; pure helpers stay off the `LioraTUI` class.
- Behavior changes to transcript, render, keys, or the bundled CLI need a focused test or `pnpm -C apps/liora run build && pnpm -C apps/liora run smoke` — not inspection alone.
