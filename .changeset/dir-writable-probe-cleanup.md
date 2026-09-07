---
"@superliora/liora": patch
---

Treat a successful write-probe creation as the verdict in `isDirWritable`: a probe directory that could not be removed (AV hold, immutable flags) no longer reports the volume as unwritable, keeping sqlite indexes off the OS temp drive.
