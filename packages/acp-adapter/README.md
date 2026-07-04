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

See `docs/zh/reference/liora-acp.md` for the full capability matrix (which `Agent` methods are wired, which extensions are stubbed, image / MCP support) and `docs/zh/guides/ides.md` for Zed and JetBrains setup.

## License

MIT
