---
"@superliora/liora": minor
---

Add context-density scoring, an optional async background compaction mode, and MCP server-instructions consumption.

A gzip-based density and "surprise" score now ranks context chunks so information-dense, project-specific code is preserved over sparse boilerplate, informing both context composition and compaction-block ordering. An experimental async-compaction flag (`SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION`) starts background summarization at a lower context threshold (60%) while the turn keeps running, with a frozen zone protecting the system and initial-user messages. MCP servers that emit usage instructions in their `initialize` handshake now have those instructions surfaced into agent context automatically, so the model learns each server's tools without a per-turn prompt cost.
