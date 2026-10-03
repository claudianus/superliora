# Built-in tools

The model-visible tool set is exactly **Bash** and **SessionControl**. Native provider/auth/config, approval, Jobs, worktrees, and UI operations remain host capabilities; they are not extra model tools. Tool calls follow the configured permission policy.

## Bash

Bash executes shell commands in the session workspace unless `cwd` is supplied. Use ordinary shell programs to read/search/edit files, run checks, or call external services. Windows uses Git Bash.

| Parameter | Contract |
| --- | --- |
| `command` | Required nonempty shell command |
| `cwd` | Optional working directory |
| `timeout` | Positive integer **seconds**; default 60 foreground, 600 background |
| `run_in_background` | Return a background task ID rather than wait |
| `description` | Required short label for background execution |
| `disable_timeout` | Disable timeout for background execution only |

Example tool arguments:

```json
{"command":"git status --short","timeout":60}
```

```json
{"command":"npm run build","run_in_background":true,"description":"Build project","timeout":600}
```

Foreground stdout/stderr stream into the tool card. stdin is closed, so interactive programs receive EOF. Native process ownership and cancellation remain active; timeout or cancellation terminates the manager-owned process tree. Use the task ID with SessionControl to inspect or stop background work.

## SessionControl

`operation` is one of `spawn`, `list`, `message`, `wait`, `stop`, or `compact`. No `get` or `cancel` aliases exist.

| Operation | Arguments and behavior |
| --- | --- |
| `spawn` | Required `prompt` and `description`; returns `agentId` and `taskId` immediately. Optional `model`, `timeout`, `cwd`, `ownership` |
| `list` | List child sessions and background tasks |
| `message` | Required `id` and `message`; steer a running child or resume an idle child |
| `wait` | Required `id`; optional `timeout` in seconds (default 30; 0 reads current output). Returns status and bounded output |
| `stop` | Required `id`; optional `reason`; stop a task or child and settle native resources |
| `compact` | Optional `instruction` or self-authored `summary`; explicitly compact this conversation |

```json
{"operation":"spawn","prompt":"Inspect src/auth for the reported login bug. Do not edit files. Return the relevant source locations.","description":"Inspect login bug"}
```

```json
{"operation":"list"}
```

Use the real returned ID in subsequent calls:

```json
{"operation":"wait","id":"RETURNED_TASK_ID","timeout":30}
```

```json
{"operation":"message","id":"RETURNED_AGENT_ID","message":"Also inspect the logout path; keep the investigation read-only."}
```

```json
{"operation":"stop","id":"RETURNED_TASK_ID","reason":"Operator cancelled the investigation"}
```

```json
{"operation":"compact","instruction":"Preserve the current request and the confirmed login findings."}
```

Child sessions have independent conversation context, not automatic checkout isolation. `cwd` deliberately selects a directory or an existing isolated worktree; `ownership` is an optional claim, not an OS sandbox. A standalone Agent can execute Bash without a graph ID; child spawning requires a session host.

Full compaction retains the latest real user request and replaces the superseded completed prefix. It is not automatic. Conversation/journal replay restores records without executing effects again. A failed worker or execution step is not automatically retried; native cleanup ownership remains held until physical settlement, which does not rerun effects.

## Retired tools

File/search/web/media, Memory, skills, plugins/MCP, plan/goals/todos, Agent/Task orchestration, and specialized job tools are not part of the model-visible API. Native Jobs/Kanban, manual review, land, and push remain operator workflows. There is no mandatory test or review pass.

See [Major migration](../release-notes/breaking-changes.md#minimal-autonomous-runtime-major-migration), [Sessions and context](../guides/sessions.md), and [Slash commands](./slash-commands.md).
