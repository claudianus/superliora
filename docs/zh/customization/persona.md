# 人格预设（Persona）

Persona 控制**主 Agent** 的说话语气、性格与可选自定义指令。它叠在当前 agent profile 之上，不改工具腰身，也不影响子 Agent / expert persona。

## 快速开始

1. 打开 Command Hub（`Ctrl-K` / `Ctrl-Space` / `?`）或 Settings → Persona。
2. 选择 **Presets…**，挑选命名包（Efficient、Mentor、Reviewer 等）。
3. 会话会立刻 reload，新人格块即时生效。

斜杠命令：

```text
/persona list
/persona set efficient
/persona clear
```

## 预设会做什么

选择预设是**原子应用**：写入 preset id，并清空自定义 tone / personality / instructions。部分预设还会在 `~/.superliora/skills-state.json` 里启用相关 Skill（只动列出的名字，其它开关保留）。清除人格会从 `config.toml` 删除 `[persona]`，但不会回滚 Skill 开关。

配置里遗留的 `concise` 会按 `efficient` 处理。

## 进阶覆盖

Settings → Persona 仍可编辑显示名、tone、personality 与自由指令；它们会覆盖系统提示里对应的预设行。

## 其它 Settings 预设

许多 Settings 面板顶部都有 **Presets…**（外观包、compaction、skills 包、media、search、telemetry、mission、editor/notifications、harness profile 等）。Usage 等账户面板仍是状态/操作入口，不提供命名包。

## 相关

- [Agent 与子 Agent](./agents.md) — profile 与工具腰身（与 Persona 不同）
- [Agent Skills](./skills.md) — Skill 启停与斜杠激活
