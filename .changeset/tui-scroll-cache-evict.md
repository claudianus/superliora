---
"@superliora/liora": patch
---

Stop freezes from garbage-collection thrash when flinging the transcript up and down: overflow paint caches now evict off-screen cards, pure-scroll never cold-layouts history, and multi-k plain stand-ins no longer pin huge line arrays on every visit.
