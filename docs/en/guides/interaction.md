# Interaction and input

SuperLiora CLI runs as an interactive TUI (terminal user interface) built around three components: the input box, the conversation view, and the status bar. This page covers how to enter text, paste media, use the approval flow, and switch between modes.

## Input box basics

The input box accepts free-form text. Press `Enter` to send, or `Shift-Enter` / `Ctrl-J` to insert a newline. When the input box is empty, press `↑` / `↓` to browse the input history for the current working directory.

**Exiting the CLI**: press `Ctrl-D` with the input box empty, press `Ctrl-C` twice while idle, or type `/exit`. Pressing `Ctrl-C` or `Esc` during streaming output interrupts the current turn — it does not exit the program.

## Pasting images and video

SuperLiora CLI supports pasting images and video directly into the input box, so you can discuss screenshots, UI mockups, architecture diagrams, or code demos without uploading or converting files first.

**Video input is a distinctive SuperLiora capability** — you can paste a video clip and have the model analyze its content, UI flow, or code walkthrough.

How to paste:

- **macOS / Linux**: `Ctrl-V`
- **Windows**: `Alt-V`

After pasting, the input box shows a placeholder that you can edit like normal text; on submit, the placeholder is replaced with the actual content. A plain-text clipboard falls back to ordinary paste. Media support depends on the current model's multimodal capabilities (`image_in` / `video_in`); it is enabled by default when you are logged in to a SuperLiora account.

## Slash commands

Everyday actions belong in the **Command Hub** (`Ctrl-K` / `?` / `/help`): sessions, native Jobs, workers, workspace views, and Settings. Typing `/` opens autocomplete for registered built-in commands.

Anything starting with `/` is treated as a slash command. Typing `/` opens a completion menu that filters in real time as you keep typing; press `Esc` to close the menu. If nothing matches, the input is sent to the agent as a regular message.

Some commands are available only while idle. Interrupt the current turn before switching sessions or compacting. See [Slash commands reference](../reference/slash-commands.md).

## File references

Type `@` to trigger file-path completion. Selecting a path inserts its relative form into your message; the agent loads the file content directly when it reads the message. File references work in both git and non-git directories, and folder suggestions end with `/` so you can keep completing paths inside them. If the fast search helper is still downloading, SuperLiora falls back to a basic filesystem scan. Hidden paths are available, but `.git` is excluded from suggestions.

> `@` references and slash commands are separate mechanisms: `@` supplies file context, while `/` invokes registered TUI commands. Skills and plugin commands are retired.

## Approval flow

Tool calls use the configured permission mode and allow/deny/ask rules. In manual mode, calls without an applicable allow rule display an approval panel. YOLO still retains high-risk approval policy.

Use the arrow keys to select an option and press `Enter` to confirm, or press `1` / `2` / `3` to select by number directly. `Esc`, `Ctrl-C`, and `Ctrl-D` are all equivalent to rejecting.

The panel typically includes an **Approve for this session** option; selecting it auto-approves the same kind of call for the rest of the session. For permanent rules, add allow / deny entries in [Configuration files](../configuration/config-files.md#permission).

## Permission modes

Use `/permission manual`, `/permission auto`, or `/permission yolo` to select the current policy. `/auto` and `/yolo` are shortcuts. These policies govern approvals, not filesystem isolation.

Normal requests execute directly in the workspace. For an isolated checkout, start an explicit native Job/worktree or launch with `liora --worktree`. A conversation fork alone does not isolate files. Planning is ordinary conversation; there is no Plan or Goal mode and no mandatory review or verification pass.

::: warning
YOLO mode skips confirmation for file writes and command execution. Only use it in working directories you trust.
:::

### Shell mode

Shell mode lets you run terminal commands without leaving the conversation. The command output is written into the conversation context, so the agent can see the results in later turns.

- Enter: type `!` in an empty input box, or paste a command that starts with `!`.
- Exit: press `Backspace` or `Esc` in an empty input box; submitting a command also returns you to normal mode automatically.
- Run in background: while a command is running, press `Ctrl+B` to move it to a background task.

In shell mode the input box shows a `!` prompt on the left and the border turns violet. For example, you can run `!gh auth login` to sign in to the GitHub CLI without opening a new terminal, so the agent can use `gh` afterward.

## During streaming output

The input box remains usable while the agent is thinking or calling tools, and supports the following extra actions:

- **`Ctrl-S`**: inject the content in the input box into the running turn immediately, without waiting for it to finish
- **`Esc` / `Ctrl-C`**: interrupt the current turn
- **`Ctrl-O`**: globally toggle the collapsed/expanded state of tool output

## External editor

Press `Ctrl-G` to send the current input content to an external editor. When you save and close, the text is written back into the input box; if you close without saving, the original content is preserved. This is handy when you need to enter large blocks of text or content with complex formatting.

Editor priority: `/editor` config → `$VISUAL` environment variable → `$EDITOR` environment variable. If none are set, run `/editor` first to choose a default.

## Next steps

- [Keyboard shortcuts](../reference/keyboard.md) — full quick-reference table of all shortcuts
- [Slash commands](../reference/slash-commands.md) — all built-in commands with descriptions and aliases
- [Sessions and context](./sessions.md) — how to resume sessions, compress context, and export conversations
