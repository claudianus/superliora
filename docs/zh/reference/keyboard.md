# 键盘快捷键

SuperLiora CLI 的 TUI 交互模式把主提示区快捷键保持精简，多数入口集中在 Command Hub。按 `Ctrl-K` 或空提示下的 `?`，或输入 `/help`，可打开内置参考。实时速查表来自 TUI keymap，本文与之对齐。

## 始终可用

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl-K` | 打开 Command Hub 菜单（`Ctrl-Space` 同样可用） |
| `Enter` | 提交当前输入 |
| `Shift-Enter` / `Ctrl-J` | 插入换行 |
| `Esc` | 关闭弹窗 / 取消补全 / 中断流式输出；空闲时连按两次为 **会话撤销（session undo）** |
| `Ctrl-C` | 停止当前轮次；空闲时清空输入或确认退出 |

**流式输出期间**按 `Ctrl-C` 会立即取消，无需二次确认。

**退出程序**（空输入 + `Ctrl-C`，或 `Ctrl-D`）使用双击确认：第一次按下后状态栏提示，再按一次相同键才退出。中途按其他键会清除确认状态。

## 仅空闲

| 快捷键 | 功能 |
| --- | --- |
| `?` | 打开 Command Hub（仅空提示） |
| `Ctrl-R` | 搜索输入历史（空提示） |
| `Ctrl-F` | 搜索对话记录 |
| `Ctrl-X` | 暂存或恢复草稿提示 |
| `Ctrl-G` | 在外部编辑器中编辑当前输入 |
| `Shift-Tab` | 切换 Ultrawork mode |
| `↑` / `↓` | 浏览输入历史（空提示） |
| `PgUp` / `PgDn` | 滚动对话记录（空提示） |
| `!` | 进入 Shell 模式（空提示） |

若快捷键因条件不满足无法执行（例如流式中打开 Hub，或提示非空时按 `Ctrl-R`），TUI 会显示简短 toast，而不是静默无响应。

按 `Shift-Tab` 可开启或关闭 Ultrawork mode。开启后，下一个普通 prompt 会先进入只读 research prelude，再进入 UltraPlan interview，形成可验证的 UltraGoal，然后按 Swarm decision、integration、verification、learning 的顺序推进。除非 Ultrawork mode 已开启，或 prompt 明确要求 UltraWork，普通 prompt 不会进入这个工作流。

在空输入框中键入 `!` 进入 Shell 模式，可直接运行终端命令；命令运行期间按 `Ctrl+B` 可将其转为后台任务。详见[交互与输入](../guides/interaction.md#shell-模式)。

## 流式输出期间

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl-S` | Steer：将当前输入注入正在运行的轮次 |
| `Ctrl-B` | 将当前工作转到后台 |
| `Esc` / `Ctrl-C` | 中断当前流式输出 |

## 撤销命名

| 动作 | 快捷键 |
| --- | --- |
| **编辑撤销（edit undo）**（缓冲区） | 编辑器中的 `Ctrl-Z` |
| **会话撤销（session undo）**（轮次 / 消息） | 空闲时 `Esc` `Esc` |

失败轮次请从 Command Hub → Chat → Retry，或使用 `/retry`。

## 外部编辑器与粘贴

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl-G` | 在外部编辑器中编辑当前输入 |
| `Ctrl-V` | 粘贴剪贴板中的图片或视频（Unix / macOS） |
| `Alt-V` | 粘贴剪贴板中的图片或视频（Windows） |

`Ctrl-G` 按以下优先级选择编辑器：`/editor` 配置、`$VISUAL`、`$EDITOR`。保存并退出后替换输入框；不保存退出则保持原样。

粘贴图片或视频时，输入框中显示占位符，实际媒体数据在提交时一并发送给模型。

## Hub 与斜杠（非主区和弦）

工具输出展开、待办展开、UltraPlan 调向与重试在 Command Hub 或斜杠命令（`/plan`、`/retry` 等）中提供，不再作为主提示区独立和弦。

## 审批面板

当 Agent 发起需要确认的工具调用时，TUI 会弹出审批面板。详细审批流程见[交互与输入](../guides/interaction.md#审批流程)，面板内可用键位如下：

| 快捷键 | 功能 |
| --- | --- |
| `↑` / `↓` | 在候选选项之间移动光标 |
| `Enter` | 确认当前选中的选项 |
| `1` ~ `9` | 直接选择对应序号的选项 |
| `Esc` / `Ctrl-C` / `Ctrl-D` | 拒绝当前请求 |
| `Ctrl-E` | 面板包含 diff 或文件内容预览时，展开或折叠完整内容 |

需要附带反馈的选项（如「Reject」「Revise」）会在确认后切换到反馈输入态：直接输入反馈文本，按 `Enter` 提交；按 `Esc` 退出反馈输入并回到候选列表。

## 弹窗模式

通过 `/help` 或 Command Hub 快捷键面板打开帮助后，可使用：

| 快捷键 | 功能 |
| --- | --- |
| `↑` / `↓` | 单行滚动 |
| `PageUp` / `PageDown` | 每次滚动 10 行 |
| `Esc` / `Enter` / `q` / `Q` | 关闭面板 |

## 下一步

- [斜杠命令](./slash-commands.md) — TUI 内置的控制命令速查
- [kimi 命令](./liora-command.md) — 启动参数与子命令完整参考
