---
"@superliora/liora": patch
---

Give credential handler failures their own error code instead of reusing the question-handler code, and surface a telemetry event plus a log line when a permission ask is auto-approved because no approval channel is connected. Also map an unrecognized headless goal terminal status to a failure exit code instead of silently exiting 0.
