---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/records/migration regression cases

- `AGENT_WIRE_PROTOCOL_VERSION` constant pin (`1.4`).
- `isNewerWireVersion()` older / current / newer-major / malformed branches.
- `resolveWireMigrations()` equal / newer / older branches.
