---
"@superliora/liora": patch
---

Stop a short transcript from blanking to placeholder rows on scroll frames that follow an animation tick, and cut the compositor's per-row work: row ids and the underlay map are only built when the composition cache is on, and the region-constant part of every row key is hashed once per region instead of once per row.