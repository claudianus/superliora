# Sessions and context

SuperLiora CLI persists every conversation as a "session" — storing message history and metadata so you can close the terminal and pick up right where you left off. This page covers how to resume sessions, manage context, and export or fork sessions.

## Session storage

All sessions are saved under `$SUPERLIORA_HOME/sessions/` (default: `~/.superliora/sessions/`), grouped by working directory:

```text
~/.superliora/
├── config.toml
└── sessions/
    ├── index.jsonl
    └── <workDirKey>/
        └── <sessionId>/
            ├── state.json
            ├── ui/
            │   ├── draft.json
            │   └── prefs.json
            └── agents/
                ├── main/
                │   └── wire.jsonl
                └── <subagentId>/
                    └── wire.jsonl
```

- `state.json`: session metadata such as title, working directory, and agent folders stored relative to the session (`agents/main`).
- `sessions/index.jsonl`: last-wins locator for session folders. Older leftover `session_index.jsonl` is still read until the index is rewritten.
- `agents/*/wire.jsonl`: the agent event stream, used for session recovery and replay.

::: warning
Do not manually edit files inside the `sessions/` directory — doing so may prevent sessions from being restored correctly.
:::

## Starting and resuming sessions

Every time you run `liora` directly it creates a new session. To resume a previous session, use one of the following:

**Resume the most recent session in the current directory:**

```sh
liora --continue
```

**Resume a specific session by ID:**

```sh
liora --session abc123
```

**Interactively browse session history and choose one:**

```sh
liora --session
```

::: warning
`--continue` and `--session` are mutually exclusive.
:::

## Switching sessions inside the TUI

You can manage sessions without leaving the terminal. The following slash commands are available only when the agent is idle:

- **`/new`** (alias `/clear`): switch to a new session, discarding the current context.
- **`/sessions`** (alias `/resume`): browse and resume a previous session.
- **`/fork`**: fork the current session (see below).
- **`/title <text>`** (alias `/rename`): set a session title for easier identification; without arguments, displays the current title.

## Context compression

Context compaction is explicit: run `/compact` when you want to replace the superseded completed conversation prefix with a summary. The latest real user request is retained. The runtime does not automatically compact at a configured threshold.

```
/compact
```

You can pass a hint to tell the model what to prioritize when compressing:

```
/compact Keep the discussion about database migrations
```

The model can request the same full compaction through SessionControl. A supplied `summary` avoids a summarization model call; `instruction` guides a generated summary. Stored conversation and journal records support recovery and replay, but replay never reruns shell commands or other effects.

## Forking a session

To explore a new direction without disrupting the current conversation, use `/fork`:

```
/fork
```

The fork has its own durable conversation and can be resumed through `/sessions`. It is not a filesystem branch: both sessions can use the same workspace. `/btw` uses a durable aside fork to answer a side question without replacing the main conversation.

## Exporting a session

Use `liora export` to package a session as a ZIP file — useful for sharing, archiving, or filing a bug report:

```sh
liora export <sessionId>
```

Omitting `sessionId` exports the most recent session in the current directory (with an interactive confirmation prompt; add `-y` to skip). Use `-o` to specify an output path:

```sh
liora export <sessionId> -o ~/Desktop/my-session.zip
```

The export includes all files in the session directory, including diagnostic logs. The global diagnostic log (`~/.superliora/logs/liora.log`) is also bundled by default; add `--no-include-global-log` to exclude it.

You can also export from inside the TUI without leaving the interactive session:

- **`liora export`**: produces a debug ZIP from the shell (TUI Markdown export is `/export-md`).
- **`/export-md`** (alias `/export`): exports the conversation as a human-readable Markdown file, suitable for sharing or archiving. Accepts an optional path argument; without one, it writes to `kimi-export-<short-id>-<timestamp>.md` in the current working directory.

::: tip
Exported files may contain code, command output, and file paths that are sensitive. Review the content before sharing.
:::

## Next steps

- [Data locations](../configuration/data-locations.md) — full directory layout for session files
- [liora command reference](../reference/liora-command.md) — complete parameter reference for `--continue`, `--session`, `export`, and other commands
