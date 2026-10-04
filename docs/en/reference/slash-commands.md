# Slash commands

Open the **Command Hub** with `Ctrl-K`, `?` on an empty prompt, or `/help`. Type `/` for built-in command completion. Commands are operator controls, not extra model-visible tools. Unmatched slash-prefixed input is sent as ordinary conversation; it does not invoke a skill or plugin.

Commands that switch sessions or mutate conversation context require an idle session. Interrupt with `Esc` or `Ctrl-C` first. The live Hub is the authority for action availability.

## Account and configuration

| Command | Purpose |
| --- | --- |
| `/login`, `/logout` | Connect or disconnect native provider credentials |
| `/accounts` | Manage connected accounts |
| `/github-connect` | GitHub connection flow |
| `/model` | Select an explicitly configured model |
| `/thinking [off\|on\|low\|medium\|high\|xhigh\|max]` | Select supported thinking effort |
| `/settings` (`/config`) | Native runtime and UI settings |
| `/permission [manual\|auto\|yolo]` | Select approval policy |
| `/auto [on\|off]` | Toggle automatic permission handling |
| `/yolo [on\|off]` (`/yes`) | Toggle YOLO; high-risk approval policy remains |
| `/editor` | External editor for `Ctrl-G` |
| `/theme` | Theme picker; custom themes remain supported |
| `/locale [auto\|en\|ko]` | UI locale |
| `/appearance`, `/performance` | UI presentation/performance preferences |
| `/host-setup [status\|apply]` | Inspect or explicitly apply terminal/shell host setup |
| `/upgrade` (`/update`) | Upgrade controls |

## Sessions and work

| Command | Purpose |
| --- | --- |
| `/new` (`/clear`) | Start a fresh conversation |
| `/sessions` (`/resume`) | Browse and resume saved sessions |
| `/folder [path]` | Select workspace |
| `/add-dir [list\|path]` | Add or list additional workspace directories |
| `/fork` | Durable independent conversation; not a git branch |
| `/btw <question>` | Durable aside fork for a side question |
| `/title <text>` (`/rename`) | Session title |
| `/compact [instruction]` | Explicit full compaction; retain latest real user request |
| `/queue clear` | Clear the TUI prompt queue |
| `/undo` | Conversation undo; not effect rollback |
| `/retry` | Explicit operator retry of a turn, not automatic recovery |
| `/reload` | Reload session configuration |
| `/reload-tui` | Reload UI preferences and active theme |
| `/export-md [path]` (`/export`) | Markdown conversation export |
| `/jobs [board\|deck [id]\|dock\|bg\|job_id]` | Native Jobs/Kanban and worker/background views |
| `/job board\|deck\|dock\|bg\|list\|inbox\|resume\|cancel\|inspect` | Native job operations; use Hub for available manual review/land/push actions |

Normal prompts run directly in the current workspace. A conversation fork or child session is not an isolated checkout; use an explicit native Job/worktree when isolation is needed. No runtime policy forces verification or review before returning a result.

## Operational views

`/status`, `/usage`, `/quota`, `/diff [path]`, `/log [filter]`, `/errors`, `/files`, `/search <pattern>`, `/web <url>`, and `/blame <path>` expose native operational UI views. `/transcript [minimal|compact|standard|full]` changes transcript density; `/neat` adjusts presentation. `/help`, `/version`, and `/exit` remain available.

## Removed surfaces

Plan/Goal/Ask modes, `/plan`, `/goal`, `/ask`, `/memory`, skill commands, `/plugins`, `/mcp`, `/mcp-config`, persona/workflow/catalog commands, and experimental orchestration are retired. Do not replace these with aliases. Describe the task, any approval boundary, and required checks in an ordinary prompt. See [Major migration](../release-notes/breaking-changes.md#minimal-autonomous-runtime-major-migration).

File rewind and the AI-attribution markers (`✦`) in `/blame` are retired. Both read per-file records that only the removed Write/Edit/ApplyPatch tools wrote; Bash edits leave no such record. `/rewind` stays reserved so the text is not sent to the model as a prompt, but it only prints rollback guidance: use git (`git diff`, `git restore <path>`, `git stash`) or start risky work with `liora --worktree`. `/blame` shows plain `git blame`. Old `provenance.ndjson` files in session directories are no longer read and can be deleted.

See [Keyboard shortcuts](./keyboard.md), [Interaction and input](../guides/interaction.md), and [Tools](./tools.md).
