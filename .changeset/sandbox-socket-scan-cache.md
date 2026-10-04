---
"@superliora/liora": patch
---
The Docker sandbox no longer rescans the whole workspace for host sockets on every command, and large workspaces no longer hit the scan limit. Only directories that changed are read again, and the first full scan runs without blocking the UI. Sockets are still rejected.
