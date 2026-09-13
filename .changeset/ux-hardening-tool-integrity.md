---
'@superliora/liora': patch
---

Keep agent tool outcomes honest: a crashed post-tool hook no longer reports a successful file edit as failed, repeated edits re-verify the file on disk before replaying a cached result, and a partially applied multi-file patch reports which files were written.
