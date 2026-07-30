# 插件（Plugins）

插件把可复用的 SuperLiora CLI 能力打包成可安装单元，格式与 **Claude Code 插件**一致。可添加 [Agent Skills](./skills.md)、斜杠命令、子代理、生命周期 [Hooks](./hooks.md) 以及 [MCP](./mcp.md) 服务器。适合团队共享工作流、对接外部服务，或从 marketplace 安装扩展。

> **破坏性变更：** SuperLiora 不再读取 `kimi.plugin.json` 或 `.kimi-plugin/plugin.json`。仍使用旧清单的插件需改成 `.claude-plugin/plugin.json` 后重新安装。

## 安装与管理

在 TUI 中运行 `/plugins` 打开插件管理器。面板含四个标签页——**Installed**、**Official**、**Third-party**、**Custom**——用 `Tab` / `Shift-Tab` 切换。

| 命令 | 说明 |
| --- | --- |
| `/plugins` | 打开交互式插件管理器 |
| `/plugins list` | 列出已安装插件 |
| `/plugins install <path-or-url>` | 从本地目录、zip URL 或 GitHub 仓库安装 |
| `/plugins marketplace [source]` | 浏览 marketplace，或传入自定义 marketplace JSON 路径/URL |
| `/plugins info <id>` | 查看插件详情与诊断信息 |
| `/plugins enable <id>` / `/plugins disable <id>` | 启用或禁用插件 |
| `/plugins remove <id>` | 移除插件（需确认） |
| `/plugins reload` | 重新加载 `installed.json` 与所有清单 |
| `/plugins mcp enable <id> <server>` | 启用插件声明的 MCP 服务器 |
| `/plugins mcp disable <id> <server>` | 禁用插件声明的 MCP 服务器 |

### 说明

- 插件变更在 `/reload` 或新会话后生效。
- 安装副本位于 `$SUPERLIORA_HOME/plugins/cache/<id>/<version>/`。安装后修改源目录不会生效，需重新安装。
- 移除只删除安装记录，缓存副本仍保留在磁盘上。
- **用户 scope** 安装记录在 `$SUPERLIORA_HOME/plugins/installed.json`，跨项目生效。
- **项目 scope** 会合并会话工作目录下的 `.superliora/plugins/installed.json`（同 id 时项目优先）。`/plugins` 的 enable/disable/remove 仍只改用户安装。
- **会话 scope：** `liora --plugin-dir <path>`（可重复）仅在当前进程加载本地 Claude 插件，不落盘。

### 自定义 marketplace JSON

向 `/plugins marketplace <source>` 传入路径或 URL，或设置 [`SUPERLIORA_PLUGIN_MARKETPLACE_URL`](../configuration/env-vars.md)。目录采用 Claude Code marketplace 形态（`name`、`owner`、`plugins[]`，条目含 `name` + `source`）：

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

## 插件包布局

插件是遵循 Claude Code 约定的目录（或 zip）：

```text
my-plugin/
  .claude-plugin/
    plugin.json          # 可选元数据；无清单时按目录约定自动发现
  skills/<name>/SKILL.md
  commands/*.md          # 斜杠命令
  agents/*.md            # Agent 工具可用的子代理定义
  hooks/hooks.json       # Claude 嵌套 hooks 结构
  monitors/monitors.json # 会话后台 monitors
  .mcp.json              # MCP 服务器
  bin/                   # 启用时前置到 Bash PATH
  settings.json          # 会话内存 overlay（从不写 config.toml）
  output-styles/         # 启用时注入 system-reminder 风格说明
  .lsp.json              # LSP 服务器（会话 reminder + Edit/Write stdio diagnostics）
  themes/*.json          # Claude 主题，出现在 `/theme`（id: plugin-<id>-<slug>）
  workflows/             # *.md → 斜杠命令别名；*.js/*.ts 仅发现
  SKILL.md               # 无 skills/ 时可选的根级单个 Skill
```

不要把 `skills/`、`commands/`、`agents/`、`hooks/` 放进 `.claude-plugin/`——该目录只放 `plugin.json`。

### 清单

可选路径：`.claude-plugin/plugin.json`

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "示例工作流",
  "skills": "./extra-skills/",
  "mcpServers": "./.mcp.json"
}
```

| 字段 | 行为 |
| --- | --- |
| `name` | 有清单时必填；插件 id（`[a-z0-9][a-z0-9_-]{0,63}`）。无清单时用目录名。 |
| `displayName`、`version`、`description`、`keywords`、`author`、`homepage`、`repository`、`license` | 元数据 |
| `defaultEnabled` | 首次安装默认启用状态（默认 `true`） |
| `skills` | 额外 `./` skill 根目录，**追加**到默认 `skills/` |
| `commands` / `agents` / `hooks` | 若指定则**替换**该组件的默认目录 |
| `mcpServers` | 内联服务器，或**补充** `.mcp.json` 的路径 |
| `monitors` | Claude monitors 路径或内联（默认 `monitors/monitors.json`） |
| `userConfig` | Claude 选项 schema；值为 `${user_config.KEY}` / `CLAUDE_PLUGIN_OPTION_*` |
| `dependencies` | 声明的 marketplace 依赖；可解析时自动安装缺失项；版本不匹配仅告警 |

当前主机：skills、commands、agents、hooks（`command`/`http`/`mcp_tool`/`prompt`/`agent` + `if`/exec-form）、MCP、bin、monitors、userConfig、`settings.json` overlay、output styles（`force-for-plugin`）、themes（`/theme`）、LSP（Edit/Write diagnostics）、dependencies（semver + marketplace 自动安装）、markdown + JS workflows（`agent`/`pipeline`）、channels（经 `--channels` 显式 opt-in 入站注入）。见 [Claude 迁移](./claude-migration.md)。

### Themes

插件 `themes/*.json` 使用 Claude 形状（`name`、`base`、`overrides`），也接受 SuperLiora `colors`。已启用插件的主题会出现在 `/theme` 中，id 为 `plugin-<pluginId>-<slug>`（只读目录；本地编辑请复制到 `~/.superliora/themes/`）。

### Workflows 与 channels

- `workflows/*.md` 注册为斜杠命令 `workflow:<slug>`（或 frontmatter `name`）。
- `workflows/*.{js,mjs,cjs}` 在 dynamic workflow 主机中运行（`agent` / `pipeline`）。为迁移也会加载项目 `.claude/workflows` 与 `~/.claude/workflows`。通过 RPC `listWorkflows` / `runWorkflow`（或 TUI `/workflows`）执行。
- `channels` 绑定 `mcpServers` 键。用 `liora --channels <server>`（可重复）启用入站注入。

### LSP 与 dependencies

- `.lsp.json` 在会话开始时列出。Edit/Write 后会惰性连接 stdio LSP，二进制可用时把 diagnostics 追加到工具结果。
- 声明的 `dependencies` 在 marketplace 可解析时自动安装缺失项；版本不匹配保持告警。

## Skills 与命令

插件 Skill 使用与普通 [Agent Skills](./skills.md) 相同的 `SKILL.md` 格式。命令是 `commands/`（或清单中的路径）下的 markdown。通过 `/<pluginName>:<command>` 调用。

## Agents

`agents/` 下的 markdown 注册为 Agent 工具的 `subagent_type`，名为 `<pluginName>:<agentName>`（唯一时可只用 `<agentName>`）。frontmatter 可含 `name`、`description`、`tools`、`disallowedTools`、`model`、`effort`、`maxTurns`、`skills`、`memory`、`background`、`isolation`。插件 agent 不得设置 `hooks`、`mcpServers`、`permissionMode`。

## MCP 服务器

在 `.mcp.json` 或清单中声明。插件内路径使用 `${CLAUDE_PLUGIN_ROOT}`（以及已配置时的 `${user_config.KEY}`）：

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

运行时服务器名为 `plugin:<pluginId>:<serverName>`。stdio 进程会收到 `CLAUDE_PLUGIN_ROOT`、`CLAUDE_PLUGIN_DATA`、`SUPERLIORA_HOME` 以及 `CLAUDE_PLUGIN_OPTION_*`。

## Hooks

使用 Claude Code 嵌套 hooks JSON（`hooks/hooks.json` 或清单内联 `hooks`）。SuperLiora 执行 `command` 与 `http`；`prompt` / `agent` / `mcp_tool` 先注册并 fail-open，会话侧执行后续补齐。`config.toml` 的 flat `[[hooks]]` 仍只支持 command。

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

Hook 进程的 cwd 为插件根目录，并收到 `SUPERLIORA_HOME`、`CLAUDE_PLUGIN_ROOT`、`CLAUDE_PLUGIN_DATA`。会话初始化请使用 Claude `SessionStart` / `Setup` hook（不再支持 SuperLiora `sessionStart.skill`）。

## Monitors

`monitors/monitors.json` 中带 `name` + `command`（可选 `when: "always"`）的条目会在插件启用时作为分离后台任务启动。stdout 行会触发 `Notification` hook，并把简短通知 steer 进会话。

## bin/

启用插件时，`bin/` 下的可执行文件会前置到 Bash 工具的 `PATH`。

## Kimi Datasource

官方数据插件（Claude 布局，位于 `plugins/official/kimi-datasource`）。完成 `/login` 后从 **Official** 标签安装，再执行 `/reload` 或 `/new`。

## 安全模型

- 安装与会话启动不会执行声明之外的任意插件工具（MCP/hooks 除外）。
- 路径在解析符号链接后必须留在插件根目录内。
- 已启用插件的 MCP 在 `/reload` 或新会话后启动，可随时在 `/plugins` 中禁用。
- 损坏的清单会出现在 `/plugins info <id>` 诊断中。
