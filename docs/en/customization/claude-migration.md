# Claude Code → SuperLiora migration

Bring Claude Code plugins and workflows into SuperLiora with minimal rewrites. SuperLiora hosts Claude’s package layout; UX stays SuperLiora (`/plugins`, `/theme`, `/workflows`).

## What works today

| Claude surface | SuperLiora host |
| --- | --- |
| `.claude-plugin/plugin.json` + auto-discover dirs | Install / enable via `/plugins` |
| skills, commands, agents, MCP, bin | Session catalog + tools |
| hooks (`command` / `http` / `mcp_tool` / `prompt` / `agent`) | HookEngine + session hosts |
| monitors, themes, settings.json (allowlisted overlay) | Background + `/theme` + in-memory overlay |
| `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` / `${user_config.*}` | Expanded on install/session |
| `.lsp.json` | Edit/Write stdio diagnostics |
| `workflows/*.md` | Slash command aliases |
| `workflows/*.{js,mjs,cjs}` | Dynamic workflow runtime (`agent` / `pipeline`) |
| Project / user / local / session scopes | See below |
| Channels (MCP `notifications/claude/channel`) | Opt-in inbound inject + permission relay |

## Quick migrate

1. Convert any legacy `kimi.plugin.json` to `.claude-plugin/plugin.json` (Kimi format is rejected).
2. Install: `/plugins install <path-or-url>` or `liora --plugin-dir ./my-plugin`.
3. Copy saved workflows:
   - Project: keep `.claude/workflows/` (also loaded).
   - Personal: `~/.claude/workflows/` is loaded for migration.
4. Re-enter `userConfig` values when enabling if prompted (`/plugins` or RPC `setPluginUserConfig`).
5. For chat/alert channel plugins, enable channels for the session (`--channels` / session opt-in).

## Scopes

| Scope | Location | Notes |
| --- | --- | --- |
| `user` | `$SUPERLIORA_HOME/plugins/installed.json` | Default; `/plugins` mutates |
| `project` | `.superliora/plugins/installed.json` | Shared; wins over user on id clash |
| `local` | `.superliora/plugins/installed.local.json` | Gitignored-style; wins over project |
| `session` | `liora --plugin-dir` | Ephemeral, always enabled |

## Not cloned (by design)

- Claude managed/org policy plugins
- Claude Agent Teams product surface
- `claude plugin *` CLI 1:1 names (use `/plugins` / SuperLiora CLI)
- Anthropic channel marketplace allowlist UX

## How we prove plugins work

Two layers:

1. **Synthetic golden fixtures** — `packages/agent-core/test/fixtures/claude-migration/`  
   Covers layout, hooks, `userConfig`, workflow JS VM, channel inject path.
2. **Official Anthropic plugins** — vendored under `packages/agent-core/test/fixtures/claude-official/`  
   Snapshots from [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) (`SOURCE.md` has the pin). Exercises:
   - `example-plugin` — skills, commands, MCP, `CLAUDE_PLUGIN_DATA`
   - `commit-commands` — real slash-command pack
   - `security-guidance` — nested hooks, `${CLAUDE_PLUGIN_ROOT}`, `if` filters, live `sg-python.sh` spawn
   - `explanatory-output-style` — SessionStart hooks
   - `fakechat` — channel-oriented MCP plugin install

```bash
# Both proof suites
pnpm -C packages/agent-core run prove:claude-plugins

# Or individually
pnpm -C packages/agent-core exec vitest run test/plugin/claude-migration-harness.test.ts
pnpm -C packages/agent-core exec vitest run test/plugin/claude-official-proof.test.ts
```

Manual smoke (optional): `liora --plugin-dir packages/agent-core/test/fixtures/claude-official/commit-commands` then invoke `/commit-commands:commit` in a session.
