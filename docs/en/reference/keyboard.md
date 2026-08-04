# Keyboard Shortcuts

SuperLiora CLI's TUI interactive mode keeps a small main-prompt keymap and routes most discovery through the Command Hub. Type `Ctrl-K` or `?` (empty prompt), or `/help`, for the built-in reference. The live cheatsheet is sourced from the TUI keymap — this page mirrors that list.

## Always

| Shortcut | Function |
| --- | --- |
| `Ctrl-K` | Open the Command Hub menu (`Ctrl-Space` also works) |
| `Enter` | Submit the current input |
| `Shift-Enter` / `Ctrl-J` | Insert a newline |
| `Esc` | Close a popup / cancel completion / interrupt streaming; press twice while idle for **session undo** |
| `Ctrl-C` | Stop the current turn, or clear input / confirm exit when idle |

Pressing `Ctrl-C` **during streaming** cancels immediately — no second confirmation needed.

**Exiting** (empty input + `Ctrl-C`, or `Ctrl-D`) uses double-press confirmation: the status bar prompts after the first press; a second press of the same key exits. Any other key clears the confirmation.

## Idle only

| Shortcut | Function |
| --- | --- |
| `?` | Open Command Hub (empty prompt only) |
| `Ctrl-R` | Search input history (empty prompt) |
| `Ctrl-F` | Search the transcript |
| `Ctrl-X` | Stash or restore the draft prompt |
| `Ctrl-G` | Edit the current input in an external editor |
| `Shift-Tab` | Toggle Mission mode |
| `↑` / `↓` | Browse input history (empty prompt) |
| `PgUp` / `PgDn` | Scroll the transcript (empty prompt) |
| `!` | Enter shell mode (empty prompt) |

If a gated key cannot run (for example Hub while a turn is streaming, or `Ctrl-R` with a non-empty prompt), the TUI shows a short toast instead of doing nothing.

Press `Shift-Tab` to enable or disable Mission mode. When enabled, the next normal prompt is routed through a read-only research prelude first, then Plan interview, a verifiable goal, Swarm decision, integration, verification, and learning. Plain prompts do not enter this workflow unless Mission mode is on or the prompt explicitly asks for Mission.

Type `!` in an empty input box to enter shell mode and run terminal commands directly; while a command is running, press `Ctrl-B` to move it to a background task. See [Interaction and input](../guides/interaction.md#shell-mode).

## During Streaming

| Shortcut | Function |
| --- | --- |
| `Ctrl-S` | Steer: inject the current input into the running turn |
| `Ctrl-B` | Background the current work |
| `Esc` / `Ctrl-C` | Interrupt the current streaming output |

## Undo naming

| Action | Shortcut |
| --- | --- |
| **Edit undo** (buffer) | `Ctrl-Z` in the editor |
| **Session undo** (turn / message) | `Esc` `Esc` while idle |

Retry a failed turn from Command Hub → Chat → Retry, or with `/retry`.

## External editor & paste

| Shortcut | Function |
| --- | --- |
| `Ctrl-G` | Edit the current input in an external editor |
| `Ctrl-V` | Paste an image or video from the clipboard (Unix / macOS) |
| `Alt-V` | Paste an image or video from the clipboard (Windows) |

`Ctrl-G` picks an editor in this order: `/editor` config, `$VISUAL`, then `$EDITOR`. After save-and-exit, the edited content replaces the input box; exiting without saving leaves the input unchanged.

When pasting an image or video, a placeholder is shown in the input box — the actual media data is sent to the model when the message is submitted.

## Hub & slash (not main chords)

Tool-output expansion, todo expansion, Plan steering, and retry live in Command Hub or slash commands (`/plan`, `/retry`, …) — not as separate main-prompt chords.

| Shortcut | Function |
| --- | --- |
| `Alt-J` | Open the Conductor Job Deck monitor (worker transcripts, tokens, elapsed). Same entry as `/jobs deck` or clicking a Job Desk card |

## Approval Panel

When the Agent initiates a tool call that requires confirmation, the TUI displays an approval panel. For the full approval workflow, see [Interaction & Input](../guides/interaction.md#审批流程). The available keys inside the panel are:

| Shortcut | Function |
| --- | --- |
| `↑` / `↓` | Move the cursor between candidate options |
| `Enter` | Confirm the currently selected option |
| `1` ~ `9` | Directly select the option at the corresponding index |
| `Esc` / `Ctrl-C` / `Ctrl-D` | Reject the current request |
| `Ctrl-E` | Expand or collapse the full content when the panel contains a diff or file preview |

Options that require feedback (such as "Reject" or "Revise") switch to a feedback input state after confirmation: type the feedback text and press `Enter` to submit; press `Esc` to exit feedback input and return to the candidate list.

## Popup Mode

After opening help with `/help` or the Command Hub shortcuts panel, use:

| Shortcut | Function |
| --- | --- |
| `↑` / `↓` | Scroll one line at a time |
| `PageUp` / `PageDown` | Scroll 10 lines at a time |
| `Esc` / `Enter` / `q` / `Q` | Close the panel |

## Next steps

- [Slash Commands](./slash-commands.md) — Quick reference for built-in TUI control commands
- [`kimi` Command](./liora-command.md) — Complete reference for startup flags and subcommands
