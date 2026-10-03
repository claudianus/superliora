---
"@superliora/liora": patch
---

Isolate sandbox execution policy between Agent installations so a sibling cannot clear confinement or change another Agent's mounts. Add synchronous host-side policy fan-out and reject mounts exposing nested sockets or the effective Docker-context socket.
