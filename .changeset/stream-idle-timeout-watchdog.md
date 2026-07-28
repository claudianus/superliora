---
'@superliora/liora': minor
---

Add a stream idle timeout watchdog to the LLM generate loop: if no streamed part arrives within 5 minutes (configurable via `streamIdleTimeoutMs`), the stream is cancelled and retried automatically. Prevents indefinite hangs when a provider stops sending tokens without closing the connection.
