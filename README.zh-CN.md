# Super Kimi Code CLI

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Site](https://img.shields.io/badge/site-online-blue)](https://claudianus.github.io/super-kimi-code/zh/) <br>
[站点](https://claudianus.github.io/super-kimi-code/zh/) · [Issues](https://github.com/claudianus/super-kimi-code/issues) · [한국어](README.ko.md) · [English](README.md)

![Super Kimi Code command center](./site/assets/hero-command-center.png)

## 持续推进软件工作的 AI 编码 Agent

Super Kimi Code 是面向长周期软件任务的独立 AI 编码 Agent。它将规划、研究、目标管理、并行执行、验证、记忆和项目文档连接到同一个终端优先工作流中。

这个产品面向同时关注上下文质量、provider 可用性、证据和发布风险的项目工作。它让决策可追溯，让已验证知识可以继续复用，并帮助下一步从更清晰的起点开始。

## 核心能力

| 能力 | 支持内容 |
| --- | --- |
| UltraPlan | 通过访谈澄清需求、约束、风险和缺失事实，直到未来目标可以按 true/false 判断。 |
| UltraResearch | 检查 API、论文、发布说明和安全议题，并保留证据。 |
| UltraGoal | 在有 research 支撑的 UltraPlan 固定具体目标、完成标准和验证计划之后启动。 |
| UltraSwarm | 只有在可见的 ENGAGE/DEFER Swarm decision 之后才投入 specialist subagent。 |
| UltraWork | 将目标型工作按 research、UltraPlan、UltraGoal、Swarm decision、integration、verification、learning 的顺序路由。 |
| Provider routing | 注册 API key 与 OAuth account，并按 quota、cooldown、latency 和 route health 选择 fallback 候选。 |
| Kimi Recall | 保存项目事实、决策、流程、后续任务和 governance rule。 |
| LLM Wiki | 将代码库知识、证据和验证结果整理成可复用的项目文档。 |
| Context OS | 通过 structured working memory、repair 和 bounded rehydration 管理长会话。 |
| Premium themes | 通过 preset、外部 terminal palette 和 syntax-aware color 提升长时间终端使用的可读性。 |
| ACP support | 让兼容编辑器通过 stdio 继续同一个 Super Kimi workflow。 |

## 安装

从本 GitHub 源码仓库安装。需要 Git 和 Node.js `>=24.15.0`；Corepack 会使用 `package.json` 中固定的 pnpm 版本。

**macOS 或 Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/claudianus/super-kimi-code/main/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/claudianus/super-kimi-code/main/install.ps1 | iex
```

> Windows 用户首次启动前需要安装 [Git for Windows](https://gitforwindows.org/)。Super Kimi Code 使用 Git Bash 作为 shell 环境。如果 Git Bash 安装在非标准路径，请把 `KIMI_SHELL_PATH` 设为 `bash.exe` 的绝对路径。

打开新的 shell 后验证命令：

```sh
skimi --version
```

安装器会把源码检出到 `~/.super-kimi-code/source`，构建 CLI，并安装 `skimi` 命令。

## 快速开始

进入项目目录并启动 TUI：

```sh
cd your-project
skimi
```

首次启动时，用 `/login` 连接 OAuth account 或 API key provider。要添加 provider 和 route 候选，可以使用 TUI 中的 `/provider`，也可以使用非交互命令：

```sh
skimi provider catalog add anthropic --api-key-env ANTHROPIC_API_KEY
skimi provider key add openai --api-key-env OPENAI_BACKUP_KEY --label backup --auto-route
skimi provider route preview <modelAlias>
skimi provider route status <sessionId>
```

大型实现任务可以从 UltraWork 开始。在 TUI 中按 `Shift-Tab` 开启 Ultrawork mode；除非该模式已开启，或你明确要求 UltraWork，否则普通 prompt 会保持轻量处理。

```sh
skimi -p "/ultrawork Audit this repo, plan the migration, implement it, run verification, and summarize the release risk."
```

或者在 TUI 中这样请求：

```text
Use UltraWork. Analyze this project, identify the safest migration path, implement it, verify it, and preserve the important decisions in memory.
```

## 在编辑器中使用

Super Kimi Code 支持 Agent Client Protocol。登录一次后，让编辑器运行 `skimi acp` 即可。

Zed 示例：

```json
{
  "agent_servers": {
    "Super Kimi Code": {
      "type": "custom",
      "command": "skimi",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

## 文档

- [中文站点](https://claudianus.github.io/super-kimi-code/zh/)
- [한국어 사이트](https://claudianus.github.io/super-kimi-code/)
- [English site](https://claudianus.github.io/super-kimi-code/en/)

## 本地开发

环境要求：Node.js `>=24.15.0`，pnpm `10.33.0`。

```sh
git clone https://github.com/claudianus/super-kimi-code.git
cd super-kimi-code
pnpm install
```

```sh
pnpm dev:cli
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## 社区

- [Issues](https://github.com/claudianus/super-kimi-code/issues)
- 安全漏洞反馈请见 [SECURITY.md](SECURITY.md)。

## 许可证

基于 [MIT License](LICENSE) 发布。
