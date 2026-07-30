# Claude Code → SuperLiora 迁移

把 Claude Code 插件与工作流以尽量少的改写迁入 SuperLiora。SuperLiora 托管 Claude 的包布局；UX 仍用 SuperLiora（`/plugins`、`/theme`、`/workflows`）。

## 当前支持

| Claude 表面 | SuperLiora 主机 |
| --- | --- |
| `.claude-plugin/plugin.json` + 目录自动发现 | 经 `/plugins` 安装/启用 |
| skills、commands、agents、MCP、bin | 会话目录与工具 |
| hooks（`command` / `http` / `mcp_tool` / `prompt` / `agent`） | HookEngine + 会话 host |
| monitors、themes、settings.json（白名单 overlay） | 后台 + `/theme` + 内存 overlay |
| `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` / `${user_config.*}` | 安装/会话时展开 |
| `.lsp.json` | Edit/Write stdio diagnostics |
| `workflows/*.md` | 斜杠命令别名 |
| `workflows/*.{js,mjs,cjs}` | Dynamic workflow 运行时（`agent` / `pipeline`） |
| project / user / local / session 作用域 | 见下表 |
| Channels（MCP `notifications/claude/channel`） | 显式 opt-in 入站注入 + permission relay |

## 快速迁移

1. 将遗留 `kimi.plugin.json` 改为 `.claude-plugin/plugin.json`（Kimi 格式会被拒绝）。
2. 安装：`/plugins install <path-or-url>` 或 `liora --plugin-dir ./my-plugin`。
3. 复制已保存工作流：
   - 项目：保留 `.claude/workflows/`（会被加载）。
   - 个人：为迁移会加载 `~/.claude/workflows/`。
4. 启用时如提示，重新填写 `userConfig`（`/plugins` 或 RPC `setPluginUserConfig`）。
5. 聊天/告警 channel 插件需为会话启用 channels（`--channels` / 会话 opt-in）。

## 作用域

| 作用域 | 位置 | 说明 |
| --- | --- | --- |
| `user` | `$SUPERLIORA_HOME/plugins/installed.json` | 默认；`/plugins` 可改 |
| `project` | `.superliora/plugins/installed.json` | 团队共享；同 id 覆盖 user |
| `local` | `.superliora/plugins/installed.local.json` | 近似 gitignore；覆盖 project |
| `session` | `liora --plugin-dir` | 临时、始终启用 |

## 刻意不克隆

- Claude managed/组织策略插件
- Claude Agent Teams 产品面
- `claude plugin *` CLI 一一对应（用 `/plugins` / SuperLiora CLI）
- Anthropic channel marketplace allowlist UX

## 如何证明插件可用

两层：

1. **合成 golden fixtures** — `packages/agent-core/test/fixtures/claude-migration/`  
   覆盖布局、hooks、`userConfig`、workflow JS VM、channel 注入路径。
2. **Anthropic 官方插件快照** — `packages/agent-core/test/fixtures/claude-official/`  
   来自 [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official)（`SOURCE.md` 有 pin）。覆盖：
   - `example-plugin` — skills、commands、MCP、`CLAUDE_PLUGIN_DATA`
   - `commit-commands` — 真实斜杠命令包
   - `security-guidance` — 嵌套 hooks、`${CLAUDE_PLUGIN_ROOT}`、`if`、现场 `sg-python.sh` spawn
   - `explanatory-output-style` — SessionStart hooks
   - `fakechat` — channel 向 MCP 插件安装

```bash
# 两套证明一起跑
pnpm -C packages/agent-core run prove:claude-plugins

# 或分开
pnpm -C packages/agent-core exec vitest run test/plugin/claude-migration-harness.test.ts
pnpm -C packages/agent-core exec vitest run test/plugin/claude-official-proof.test.ts
```

可选手动冒烟：`liora --plugin-dir packages/agent-core/test/fixtures/claude-official/commit-commands`，会话里调用 `/commit-commands:commit`。
