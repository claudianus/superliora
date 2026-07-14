---
"@superliora/liora": patch
---

Load the large builtin skill catalog from a search index at session start instead of walking thousands of skill directories, so startup and SearchSkill stay fast while skill bodies still load on demand.
