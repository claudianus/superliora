# Claude official plugin fixtures

Vendored snapshots from [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) for SuperLiora migration proof tests.

| Path | Upstream | Role in proof |
| --- | --- | --- |
| `example-plugin/` | `plugins/example-plugin` | skills + commands + MCP layout |
| `commit-commands/` | `plugins/commit-commands` | real slash-command pack |
| `security-guidance/` | `plugins/security-guidance` | nested hooks + `${CLAUDE_PLUGIN_ROOT}` + `if` |
| `explanatory-output-style/` | `plugins/explanatory-output-style` | SessionStart hook style plugin |
| `external/fakechat/` | `external_plugins/fakechat` | channel-oriented MCP plugin manifest |

**Upstream pin:** `main` @ `4acf1a2a3014` (2026-07-26)

Refresh:

```bash
# from repo root
TMP=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/anthropics/claude-plugins-official.git "$TMP/repo"
cd "$TMP/repo" && git sparse-checkout set \
  plugins/example-plugin plugins/commit-commands plugins/security-guidance \
  plugins/explanatory-output-style external_plugins/fakechat
DEST=packages/agent-core/test/fixtures/claude-official
rm -rf "$DEST"/{example-plugin,commit-commands,security-guidance,explanatory-output-style,external}
mkdir -p "$DEST/external"
cp -R plugins/* "$DEST/"
cp -R external_plugins/fakechat "$DEST/external/"
# update SHA in this file from: git -C "$TMP/repo" rev-parse --short=12 HEAD
```
