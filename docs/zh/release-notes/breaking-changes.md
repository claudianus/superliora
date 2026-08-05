# Breaking changes

## Unreleased

### Liora Memory v2

**Affected**

- 长期记忆统一使用 `Liora Memory` 品牌，并采用 `remember`、`recall`、`reflect`、`forget`、`inspect` 五个操作。
- canonical 存储路径为 `$SUPERLIORA_HOME/memory/liora-memory.sqlite`；Context OS、压缩摘要和 archive 文件仍是分离的临时层或恢复层。
- 旧的 `MemoryKind` 值、`search` / `create` / `consolidate` 操作、`kimi-recall.sqlite` 和旧 episode 文件不再属于 v2 API 名称。

**Migration**

- 使用相同的 `SUPERLIORA_HOME` 启动一次新 CLI。它会将 `kimi-recall.sqlite`、`liora-recall.sqlite`、旧 Markdown record marker 和 JSON episode 导入 canonical 存储。
- 将 `kind` 替换为 `type`（`fact`、`event`、`procedure`、`task` 或 `rule`），并使用五个 Liora Memory 操作。
- 将 `memory/records/` 视为供人工查看和恢复的镜像，而不是第二个写入权威。迁移后使用 `inspect` 检查完整性和审计事件。
