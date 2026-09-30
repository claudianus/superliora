---
"@superliora/liora": patch
---

Cut per-frame work in the transcript renderer: row ids and the compositor's underlay map are only built when the composition cache is on, the region-constant part of a row key is hashed once per region instead of once per row, and an unchanged row's present key is reused instead of rebuilt cell by cell. Also stop a short transcript from blanking to placeholder rows on scroll frames that follow an animation tick.