---
"@superliora/liora": patch
---

Make explicit process sandbox enforcement fail closed when Docker confinement is unavailable or the execution host cannot apply it. Block pending and stale executions, harden Docker mounts and container flags, and map literal leading Bash working-directory changes into the container. Lexical enforcement remains an explicit host-execution option.
