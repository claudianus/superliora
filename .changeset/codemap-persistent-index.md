---
"@superliora/agent-core": minor
---

Persist the CodeMap symbol index under the Liora home (`~/.superliora/codemap/<repo>.sqlite`) so later sessions warm-start from the previous index instead of rebuilding from scratch

- WAL journal mode and busy_timeout keep concurrent sessions smooth while one indexer writes
- A schema-version + workspace-identity guard wipes stale rows automatically when the db no longer matches the repo
- Falls back to tmpdir when the home directory is not writable
