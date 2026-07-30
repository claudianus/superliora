# `src/mcp/`

MCP client connections (stdio/sse/http), config loading, connection manager.

## Ownership

- Transport and connection lifecycle stay here.
- Tool exposure into the agent goes through the existing tool-registration path — do not bypass `tools/` / `agent/tool`.

## Imports

- Keep MCP free of `session/` graph state. Pass session/workdir via explicit options.
