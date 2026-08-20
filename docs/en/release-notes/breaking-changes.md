# Breaking changes

## Unreleased

### Liora Memory v2

**Affected**

- Durable memory is now branded `Liora Memory` and uses the operations `remember`, `recall`, `reflect`, `forget`, and `inspect`.
- The canonical store is `$SUPERLIORA_HOME/memory/liora-memory.sqlite`; Context OS, compaction summaries, and archive files remain separate transient or recovery layers.
- Legacy `MemoryKind` values, `search` / `create` / `consolidate` verbs, `kimi-recall.sqlite`, and legacy episode files are no longer v2 API names.

**Migration**

- Open the new CLI once with the same `SUPERLIORA_HOME`. It migrates `kimi-recall.sqlite`, `liora-recall.sqlite`, legacy Markdown record markers, and JSON episodes into the canonical store.
- Replace `kind` with `type` (`fact`, `event`, `procedure`, `task`, or `rule`) and use the five Liora Memory operations.
- Treat `memory/records/` as a human-readable recovery mirror, not as a second write authority. Use `inspect` to verify integrity and audit events after migration.

## 0.3.0 (2026-08-09)

### Mission, Swarm, and legacy CLI paths

**Affected**

- Mission mode and Swarm mode surfaces (`/mission`, `/swarm`, `/fleet`, and related settings) are removed.
- Diagnostic slash commands (`/bench`, `/renderer`, `/term`, `/export-debug-zip`, `/improve-harness`, `/preflight`) and `/feedback` are removed.
- Remaining Kimi-era CLI migration and cache compatibility paths are dropped.

**Migration**

- Use `/plan`, `/goal`, the agent dock, and the job strip instead of Mission or Swarm.
- Use the `liora` command and `.superliora` paths only.
