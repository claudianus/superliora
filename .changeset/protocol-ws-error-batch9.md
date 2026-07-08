---
"@superliora/liora": patch
---

Send a WebSocket error frame (type `error`) instead of silently dropping when a client sends a malformed, non-JSON, or unknown control message, so clients can surface the problem. Allocate the reserved daemon token-auth error codes so token and origin rejections carry an application-level code instead of a bare HTTP 401.
