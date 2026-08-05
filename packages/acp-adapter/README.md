# @superliora/acp-adapter

Agent Client Protocol adapter for SuperLiora. Exposes the Liora agent over the [Agent Client Protocol](https://agentclientprotocol.com/) so that ACP-compatible clients (editors, IDEs, custom front-ends) can drive a Liora session over stdio.

Part of the [SuperLiora](https://github.com/claudianus/superliora) monorepo.

## Minimum usage

```ts
import { createLioraHarness } from '@superliora/sdk';
import { runAcpServer } from '@superliora/acp-adapter';

const harness = await createLioraHarness();
await runAcpServer(harness);
```

`runAcpServer` reads JSON-RPC from `process.stdin`, writes to `process.stdout`, and resolves when the client closes the connection. SIGINT and SIGTERM trigger a graceful drain that calls `harness.close()` before the process exits.

See `docs/en/reference/liora-acp.md` for the full capability matrix (which `Agent` methods are wired, which extensions are stubbed, image / MCP support) and `docs/en/guides/ides.md` for Zed and JetBrains setup.

## Naming (Sovereign Reform SSOT)

Session/wire APIs may still use legacy `ultrawork` / `swarm` identifiers. The interactive Liora TUI surfaces **Mission** and **Fleet** instead of Ultra\* user strings. This adapter does not expose Ultra\* labels to ACP clients.

## License

MIT
