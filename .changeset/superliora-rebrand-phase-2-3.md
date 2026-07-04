---
"@superliora/liora": major
"@superliora/agent-core": minor
"@superliora/sdk": minor
"@superliora/oauth": minor
---

Drop Kimi-era legacy compatibility: remove the `kimi` CLI shim, `.super-kimi` workspace dual-read, deprecated SDK aliases, and `managed:kimi-code` provider migration. Workspace data now lives only under `.superliora`; use the `liora` command and `managed:kimi-api` in config.
