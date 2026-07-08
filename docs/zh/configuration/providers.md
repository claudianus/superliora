# 平台与模型

SuperLiora CLI 支持同时接入多家 LLM 平台——用 SuperLiora 托管服务一键登录、用 Anthropic API key 接 Claude、用 OpenAI 兼容协议连接第三方推理服务。每个供应商对应一种 API 协议，模型在供应商之上声明自己的名称、上下文长度和能力。本页介绍如何在 `config.toml` 里配置各种供应商。

## 支持的供应商类型

`providers` 表里的 `type` 字段决定使用哪种协议实现：

| 类型 | 协议 | 典型用途 |
| --- | --- | --- |
| `kimi` | OpenAI 兼容 | SuperLiora 托管服务、Kimi Platform API 密钥 |
| `anthropic` | Anthropic Messages | Claude 系列模型 |
| `openai` | OpenAI Chat Completions | OpenAI 及兼容服务、DeepSeek、Qwen 等 |
| `openai_responses` | OpenAI Responses API | OpenAI 较新的 Responses 接口 |
| `google-genai` | Google GenAI | Gemini API |
| `vertexai` | Google GenAI on Vertex | Google Cloud Vertex AI |

所有供应商默认以流式方式与模型交互。thinking、视觉、工具调用等能力按模型名前缀自动匹配，通常不需要手动声明。

**凭证优先级**：显式 provider 凭证字段 > `[providers.<name>.env]` 子表键 > 两者都缺时启动报错。凭证值可以是原始 key，也可以是 `{env:OPENAI_API_KEY}` 这类环境变量引用。CLI 不会静默回退读取 shell 环境变量；必须把引用写入配置，或通过 provider 命令添加。详见[配置覆盖：供应商凭证](./overrides.md#供应商凭证)。

## 交互式添加供应商

不想手动编辑 TOML？在 TUI 里输入 `/login` 以交互方式添加供应商。`/login` 支持两条路径：

- **Known third-party provider**：从 [models.dev](https://models.dev/) 拉取模型目录，选供应商 → 输入 API 密钥 → 选默认模型
- **Custom registry (api.json)**：粘贴自定义 registry 地址和 Bearer token，CLI 自动创建 `providers` / `models` 条目。后续启动时，同一个 registry 地址下的供应商会一起刷新，因此上游新增、删除供应商以及模型元数据变化都会同步。

登录后用 `/model` 在刚配置好的模型间切换。

非交互环境下也可以用 shell 命令完成同样操作：[`liora provider`](../reference/liora-command.md#kimi-provider)。

## `kimi`

用于对接 Moonshot AI 的 OpenAI 兼容接口，包括 SuperLiora 托管服务和 Kimi Platform API 密钥。

- 默认 `base_url`：`https://api.moonshot.ai/v1`
- 凭证键名：`KIMI_API_KEY`、`KIMI_BASE_URL`
- 额外能力：支持视频上传

```toml
[providers.kimi]
type = "kimi"
base_url = "https://api.moonshot.ai/v1"
api_key = "sk-xxxxx"
```

> 使用 SuperLiora 托管服务时，`/login` 登录后会自动配置 `base_url` 和凭证，无需手动填写。

## `anthropic`

用于对接 Claude API。标准 Claude 模型自动启用视觉、工具调用及 Thinking（如支持）；自定义或未覆盖的模型需在 `[models.<alias>]` 里显式声明 `capabilities`。

- 默认 `base_url`：跟随 Anthropic SDK 默认值
- 凭证键名：`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`
- 默认 `max_tokens`：按模型自动推断。如需覆盖，在模型别名上设 `max_output_size`

```toml
[providers.anthropic]
type = "anthropic"
api_key = "sk-ant-xxxxx"

[models."claude-opus-4-7"]
provider = "anthropic"
model = "claude-opus-4-7"
max_context_size = 200000
# max_output_size = 32000  # 可选，省略时使用模型推断的默认值
```

## `openai`

用于对接 OpenAI Chat Completions 协议，也可连接任何兼容该协议的第三方服务（覆盖 `base_url` 即可）。

第三方推理模型（DeepSeek、Qwen、One API 等）开箱即用：CLI 自动处理 `reasoning_content` 字段和 `reasoning_effort` 注入。如果你的网关用非标准字段名返回推理内容，在模型别名上设 `reasoning_key` 覆盖。

- 默认 `base_url`：`https://api.openai.com/v1`
- 凭证键名：`OPENAI_API_KEY`、`OPENAI_BASE_URL`

```toml
[providers.openai]
type = "openai"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

## `openai_responses`

对应 OpenAI 较新的 Responses API，始终以流式方式工作。配置方式与 `openai` 相同。

- 默认 `base_url`：`https://api.openai.com/v1`
- 凭证键名：`OPENAI_API_KEY`、`OPENAI_BASE_URL`

```toml
[providers.openai-responses]
type = "openai_responses"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

## `google-genai`

用于直连 Google Gemini API。thinking、视觉及多模态能力按模型名自动识别。

- 凭证键名：`GOOGLE_API_KEY`

```toml
[providers.gemini]
type = "google-genai"
api_key = "xxxxx"
```

## `vertexai`

与 `google-genai` 共用实现，`type = "vertexai"` 时切换到 Vertex AI 访问路径。

认证走 Google Cloud 标准 ADC 流程（`gcloud auth application-default login` 或 `GOOGLE_APPLICATION_CREDENTIALS` 服务账号 JSON），这部分与 SuperLiora 无关。**项目 ID 和区域必须写在 `[providers.vertexai.env]` 子表里**——直接在 shell 里 `export GOOGLE_CLOUD_PROJECT` 不会被 CLI 读取。

```toml
[providers.vertexai]
type = "vertexai"

[providers.vertexai.env]
GOOGLE_CLOUD_PROJECT = "my-gcp-project"
GOOGLE_CLOUD_LOCATION = "us-central1"
```

```sh
gcloud auth application-default login   # 一次性完成认证
kimi
```

## OAuth 与凭证注入

SuperLiora 托管服务使用 OAuth 而非静态 API 密钥。运行 `/login` 后，内置的认证工具链会自动写入并刷新凭证，`config.toml` 里无需手动配置这部分内容。

## 凭证池与 routing

当单个上游账号不够用时，可以把 provider 凭证配置成池。凭证池允许一个模型 alias 在多个 API key、OAuth 账号、endpoint URL 或 fallback model 之间移动，同时不会在状态输出中暴露 secret。

常见配置路径建议使用 CLI：

```sh
liora provider key add openai --api-key-env OPENAI_PRIMARY_KEY --label primary
liora provider key add openai --api-key-env OPENAI_BACKUP_KEY --label backup --rpm 60 --tpm 120000 --auto-route
liora provider route preview openai/gpt-4.1
```

对于 OAuth provider，添加账号引用而不是 API key：

```sh
liora login --oauth-key kimi-work
liora provider oauth add kimi --key kimi-work --label work --auto-route
```

Route 支持 `auto`、`fallback`、`fill_first`、`round_robin`、`weighted_round_robin`、`least_used`、`lowest_latency`、`rate_limit_aware`、`random`。`auto` 策略会优先选择健康、有 rate-limit headroom、近期 latency 较低、权重更合适的 credential，再 fallback 到下一个模型 alias。

```sh
liora provider route auto openai/gpt-4.1
liora provider route set openai/gpt-4.1 --fallback anthropic/claude-opus --strategy rate_limit_aware --session-affinity on
liora provider route status <sessionId>
```

编辑配置或导入 provider 后，运行 `liora provider doctor`。它会检查缺失的环境变量引用、格式错误的 per-credential `base_url`、重复 label、损坏的 fallback alias，以及无效的 preferred credential label，并且不会打印 API key 或 OAuth storage key。

## 下一步

- [配置文件](./config-files.md) — `providers` 和 `models` 表的完整字段参考
- [配置覆盖](./overrides.md) — 供应商凭证的解析优先级规则
- [环境变量](./env-vars.md) — 各供应商对应的凭证键名列表
