# `liora acp` Subcommand

`liora acp` switches SuperLiora CLI to **ACP (Agent Client Protocol)** mode: it communicates with an ACP client (such as Zed, JetBrains AI Chat, etc.) via JSON-RPC over stdin/stdout, letting the IDE directly drive liora's sessions, prompts, and tool calls.

```sh
liora acp
```

Once started, the command prints no banner and immediately waits for the ACP client to send an `initialize` request on stdin. Logs are written to stderr (as well as the diagnostic log under `~/.superliora/logs/`), so the ACP channel itself stays clean.

::: tip Who calls this?
You typically do not need to run `liora acp` manually — this command is the subprocess entry point for IDEs. For IDE-side configuration, see [Using in IDEs](../guides/ides.md).
:::

## Capability Matrix

The table below lists the capabilities declared by the current ACP adapter layer. The `agentCapabilities` field is returned in full in the `initialize` response, so the IDE can adjust its UI accordingly.

| Capability | Value | Description |
| --- | --- | --- |
| `promptCapabilities.image` | `true` | Supports ACP `image` content blocks (base64 + mimeType) |
| `promptCapabilities.audio` | `false` | Audio prompts not yet supported |
| `promptCapabilities.embeddedContext` | `true` | Client may send `resource`/`resource_link` embedded resource blocks; text content is injected into the prompt as `<resource uri="...">...</resource>`; blob resources are dropped with a warn |
| `mcpCapabilities.http` | `false` | MCP forwarding is retired |
| `mcpCapabilities.sse` | `false` | MCP forwarding is retired |
| `loadSession` | `true` | Supports `session/load` to resume an existing session, replaying history on load |
| `sessionCapabilities.list` | `{}` | Supports `session/list` to enumerate the current user's sessions |
| `sessionCapabilities.resume` | `{}` | Supports resuming without history replay |

## ACP Method Coverage

The spec divides methods into a **stable** surface and an evolving **unstable** surface (handlers mounted with the `unstable_*` prefix in `@agentclientprotocol/sdk@0.23.0`). The two have entirely different stability guarantees — the stable surface covers methods every production ACP client uses, while the unstable surface covers experimental extensions (inline-edit prediction, document buffer sync, provider management, elicitation, etc.) — so they are tracked separately.

The adapter supports the normal initialize → authenticate → new/load/resume → prompt → cancel flow, native configuration pickers, history updates, and permission requests.

### Stable agent-side — IDE → agent

| Method | Implemented | Description |
| --- | --- | --- |
| `initialize` | Yes | Version negotiation; returns `agentInfo: { name: 'SuperLiora CLI', version }`, capability matrix, and `authMethods` |
| `authenticate` | Yes | Validates `method_id='login'`; returns `authRequired (-32000)` if token is missing, `invalidParams (-32602)` for unknown ID |
| `session/new` | Yes | Accepts `cwd` and empty `mcpServers`; returns native `configOptions[]` |
| `session/load` | Yes | Restores a session from disk and replays history via `session/update` |
| `session/resume` | Yes | Lightweight sibling of `session/load`; skips history replay |
| `session/prompt` | Yes | Accepts `text` / `image` / `resource` / `resource_link` content blocks; streams `agent_message_chunk` |
| `session/cancel` | Yes | Interrupts the current turn |
| `session/list` | Yes | Enumerates sessions on disk (advertised via `sessionCapabilities.list = {}`) |
| `session/set_mode` | Yes | Dispatches to native permission policy: `manual`, `auto`, or `yolo` |
| `session/set_config_option` | Yes | Native model alias / thinking / permission picker |
| `session/close` | No | |
| `logout` | No | |

### Stable client-side reverse-RPC — agent → IDE

| Method | Implemented | Description |
| --- | --- | --- |
| `session/update` | Yes | Streams message/tool events, configuration updates, and available commands |
| `session/request_permission` | Yes | Shared channel for tool approval and question elicitation |
| `fs/read_text_file` | Yes | File reads at the kaos layer are routed to the client (advertised via `fsCapabilities`) |
| `fs/write_text_file` | Yes | File writes at the kaos layer are routed to the client |
| `terminal/create` · `output` · `release` · `kill` · `wait_for_exit` | No | Terminal reverse-RPC not connected; shell commands use local execution |

### Unstable surface

| Method | Implemented | Description |
| --- | --- | --- |
| `session/set_model` | Yes | Compatibility path; equivalent to `set_config_option({configId:'model'})` |
| Remaining 18 methods | No | Includes session lifecycle extensions, buffer sync, inline-edit prediction, provider management, etc. |

All methods not listed above return `methodNotFound`.

## Minimal runtime contract

The adapter exposes Bash and SessionControl, just like the terminal session. Nonempty `mcpServers` lists on new/load/resume requests are rejected with `invalidParams`; pass an empty list. No transport is silently forwarded or dropped.

ACP modes are native permission policies (`manual`, `auto`, `yolo`), not Plan/Ask/Build workflows. Model entries come from configured native aliases; thinking is a separate option. Recovery/history replay restores conversation records without rerunning shell commands or other effects. There is no mandatory review/check pass or automatic worker retry.

## Next steps

- [Using in IDEs](../guides/ides.md) — Zed / JetBrains configuration steps and troubleshooting
- [`liora` Command Reference](./liora-command.md) — Complete subcommand list
