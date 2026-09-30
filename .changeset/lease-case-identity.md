---
"@superliora/liora": patch
---

Fix the file lease registry treating two case spellings of one file as different files on macOS, which let two workers edit the same file at once.