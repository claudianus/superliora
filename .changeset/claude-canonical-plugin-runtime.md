---
"@superliora/liora": minor
---

Claude Code → SuperLiora migration hosts: HookEngine (`http`/`mcp_tool`/`prompt`/`agent`, `if`, exec-form), monitors + userConfig prompts, user/project/local/session scopes (`--plugin-dir`), settings overlay, output-styles (`force-for-plugin`), themes in `/theme`, LSP Edit/Write diagnostics, semver deps + prune, dynamic workflow JS runtime (`agent`/`pipeline`) plus `.claude/workflows` load, and opt-in channels (`--channels`). `/plugins` UX stays the same; reinstall Claude-format plugins if you still have legacy installs. See `docs/en/customization/claude-migration.md`.
