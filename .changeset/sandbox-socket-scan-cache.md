---
"@superliora/liora": patch
---
The Docker sandbox no longer rescans the whole workspace for host sockets on every command, and large workspaces no longer hit the scan limit. A directory is re-read when it changes and until two listings a few seconds apart agree, and the first full scan runs without blocking the UI. Sockets are still rejected.
