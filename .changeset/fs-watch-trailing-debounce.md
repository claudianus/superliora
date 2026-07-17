---
"@superliora/agent-core": patch
"@superliora/server": patch
---

**FS watch burst coalescing**

- Use trailing debounce for `event.fs.changed` windows so long create bursts still coalesce and can trip the overflow (`truncated: true`) path reliably.
- Add a deterministic unit test for maxChangesPerWindow truncation.
