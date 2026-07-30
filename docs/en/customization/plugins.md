# Plugins

Plugins package reusable SuperLiora CLI capabilities into installable units using the **Claude Code plugin format**. They can add [Agent Skills](./skills.md), slash commands, subagents, lifecycle [hooks](./hooks.md), and [MCP](./mcp.md) servers. They are ideal for sharing workflows with a team, connecting to external services, or installing extensions from the marketplace.

> **Breaking change:** SuperLiora no longer reads `kimi.plugin.json` or `.kimi-plugin/plugin.json`. Reinstall plugins that still use those manifests after converting them to `.claude-plugin/plugin.json`.

## Installation and Management

Run `/plugins` in the TUI to open the plugin manager. It is a single panel with four tabs — **Installed**, **Official**, **Third-party**, and **Custom** — switched with `Tab` / `Shift-Tab`.

| Command | Description |
| --- | --- |
| `/plugins` | Open the interactive plugin manager |
| `/plugins list` | List installed plugins |
| `/plugins install <path-or-url>` | Install from a local directory, zip URL, or GitHub repository URL |
| `/plugins marketplace [source]` | Browse the marketplace, or pass a custom marketplace JSON path or URL |
| `/plugins info <id>` | View plugin details and diagnostics |
| `/plugins enable <id>` / `/plugins disable <id>` | Enable or disable a plugin |
| `/plugins remove <id>` | Remove a plugin (requires confirmation) |
| `/plugins reload` | Reload `installed.json` and all plugin manifests |
| `/plugins mcp enable <id> <server>` | Enable an MCP server declared by a plugin |
| `/plugins mcp disable <id> <server>` | Disable an MCP server declared by a plugin |

### Notes

- Plugin changes apply after `/reload` or in new sessions.
- Installations are copied to `$SUPERLIORA_HOME/plugins/cache/<id>/<version>/`. Editing the original source after install has no effect; reinstall to update.
- Removing a plugin only deletes the installation record; the cache copy remains on disk.
- **User scope** installs live in `$SUPERLIORA_HOME/plugins/installed.json` and apply across projects.
- **Project scope** merges `.superliora/plugins/installed.json` from the session workdir (project wins on id clash). `/plugins` enable/disable/remove still mutate user installs only.
- **Session scope:** `liora --plugin-dir <path>` (repeatable) loads a local Claude plugin for this process only; it is not persisted.

### Custom marketplace JSON

Pass a custom marketplace JSON path or URL to `/plugins marketplace <source>`, or set [`SUPERLIORA_PLUGIN_MARKETPLACE_URL`](../configuration/env-vars.md). The catalog uses the Claude Code marketplace shape (`name`, `owner`, `plugins[]` with `name` + `source`):

```json
{
  "name": "my-marketplace",
  "owner": { "name": "Example" },
  "plugins": [
    {
      "name": "my-plugin",
      "displayName": "My Plugin",
      "source": "./my-plugin"
    }
  ]
}
```

## Plugin package layout

A plugin is a directory (or zip) that follows Claude Code conventions:

```text
my-plugin/
  .claude-plugin/
    plugin.json          # optional metadata; components auto-discover without it
  skills/<name>/SKILL.md
  commands/*.md          # slash commands (legacy flat skills also work)
  agents/*.md            # subagent definitions for the Agent tool
  hooks/hooks.json       # Claude nested hooks schema
  monitors/monitors.json # session background monitors
  .mcp.json              # MCP servers
  bin/                   # prepended to Bash PATH while enabled
  settings.json          # in-memory session overlay (never writes config.toml)
  output-styles/         # system-reminder style instructions when enabled
  .lsp.json              # LSP servers (session reminder + Edit/Write stdio diagnostics)
  themes/*.json          # Claude themes in `/theme` (id: plugin-<id>-<slug>)
  workflows/             # *.md → slash command aliases; *.js/*.ts discovery only
  SKILL.md               # optional single root skill when skills/ is absent
```

Do **not** put `skills/`, `commands/`, `agents/`, or `hooks/` inside `.claude-plugin/` — only `plugin.json` belongs there.

### Manifest

Optional path: `.claude-plugin/plugin.json`

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "Example workflows",
  "skills": "./extra-skills/",
  "mcpServers": "./.mcp.json"
}
```

| Field | Behavior |
| --- | --- |
| `name` | Required when a manifest exists; plugin id (`[a-z0-9][a-z0-9_-]{0,63}`). Without a manifest, the directory name is used. |
| `displayName`, `version`, `description`, `keywords`, `author`, `homepage`, `repository`, `license` | Metadata |
| `defaultEnabled` | Default enable state on first install (default `true`) |
| `skills` | Extra `./` skill roots **added** to default `skills/` |
| `commands` / `agents` / `hooks` | When set, **replace** the default directory for that component |
| `mcpServers` | Inline servers, or path(s) that **supplement** `.mcp.json` |
| `monitors` | Path or inline Claude monitors (default `monitors/monitors.json`) |
| `userConfig` | Claude option schema; values expand as `${user_config.KEY}` / `CLAUDE_PLUGIN_OPTION_*` |
| `dependencies` | Declared marketplace deps; auto-install missing ids when marketplace source resolves; warn on mismatch |

Hosts today: skills, commands, agents, hooks (`command`/`http`/`mcp_tool`/`prompt`/`agent` + `if`/exec-form), MCP, bin, monitors, userConfig, `settings.json` overlay, output styles (`force-for-plugin`), themes (`/theme`), LSP (Edit/Write diagnostics), dependencies (semver + marketplace auto-install), markdown + JS workflows (`agent`/`pipeline`), channels (opt-in inbound inject via `--channels`). See [Claude migration](./claude-migration.md).

### Themes

Plugin `themes/*.json` follow Claude’s shape (`name`, `base`, `overrides`) and also accept SuperLiora `colors`. Enabled plugin themes appear in `/theme` as `plugin-<pluginId>-<slug>` (read-only catalog; copy into `~/.superliora/themes/` if you need a local edit).

### Workflows and channels

- `workflows/*.md` register as slash commands named `workflow:<slug>` (or frontmatter `name`).
- `workflows/*.{js,mjs,cjs}` run in the dynamic workflow host (`agent` / `pipeline`). Project `.claude/workflows` and `~/.claude/workflows` are also loaded for migration. Use RPC `listWorkflows` / `runWorkflow` (or `/workflows` when wired in TUI).
- `channels` bind to `mcpServers` keys. Enable inbound inject with `liora --channels <server>` (repeatable).

### LSP and dependencies

- `.lsp.json` servers are listed at session start. After Edit/Write, SuperLiora lazily talks stdio LSP and appends diagnostics to the tool result when the binary is available.
- Declared `dependencies` missing from the install set are auto-installed from the marketplace when a source can be resolved; version mismatches stay warnings.

## Skills and commands

Plugin skills use the same `SKILL.md` format as ordinary [Agent Skills](./skills.md). Commands are markdown files under `commands/` (or paths listed in the manifest). Invoke with `/<pluginName>:<command>`.

## Agents

Markdown files under `agents/` register as Agent tool `subagent_type` values named `<pluginName>:<agentName>` (bare `<agentName>` also works when unique). Frontmatter may include `name`, `description`, `tools`, `disallowedTools`, `model`, `effort`, `maxTurns`, `skills`, `memory`, `background`, and `isolation`. Plugin agents may not set `hooks`, `mcpServers`, or `permissionMode`.

## MCP servers

Declare servers in `.mcp.json` or the manifest. Use `${CLAUDE_PLUGIN_ROOT}` (and `${user_config.KEY}` when configured) for paths inside the plugin:

```json
{
  "mcpServers": {
    "data": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/server.mjs"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

Runtime server names look like `plugin:<pluginId>:<serverName>`. Stdio processes receive `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `SUPERLIORA_HOME`, and any `CLAUDE_PLUGIN_OPTION_*` values.

## Hooks

Use Claude Code nested hooks JSON (`hooks/hooks.json` or inline `hooks` in the manifest). SuperLiora runs `command` and `http` hook types; `prompt` / `agent` / `mcp_tool` are registered fail-open until session-backed execution lands. Flat `config.toml` `[[hooks]]` entries stay command-only.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/check.sh"
          }
        ]
      }
    ]
  }
}
```

Hook processes run with cwd set to the plugin root and receive `SUPERLIORA_HOME`, `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA`. Prefer Claude `SessionStart` / `Setup` hooks for session initialization (there is no SuperLiora `sessionStart.skill` field).

## Monitors

`monitors/monitors.json` entries with `name` + `command` (and optional `when: "always"`) start as detached background tasks when the plugin is enabled. Stdout lines fire `Notification` hooks and steer a short notification into the session.

## bin/

Executables under `bin/` are prepended to the Bash tool `PATH` while the plugin is enabled.

## Kimi Datasource

Official data plugin (Claude layout under `plugins/official/kimi-datasource`). Install from the **Official** tab after `/login`, then `/reload` or `/new`.

## Security model

- Install and session startup do not execute arbitrary plugin tools beyond declared MCP/hooks.
- Paths must stay inside the plugin root after symlink resolution.
- MCP servers of enabled plugins start after `/reload` or in new sessions and can be disabled from `/plugins`.
- Broken manifests appear in `/plugins info <id>` diagnostics.
