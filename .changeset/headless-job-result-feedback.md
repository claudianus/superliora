---
"@superliora/liora": patch
---

Headless `-p` runs now report the jobs the conductor created during the run: a `[jobs] …` block (or `{"type":"jobs.summary",…}` JSON line in stream-json mode) listing each job id/kind/status/title, plus a deterministic exit code — 0 when every created job is done, 4 when work is still queued/running/blocked or a coding job awaits a land decision, 5 when a job failed. Previously a plain prompt run that delegated everything to jobs printed nothing about them and always exited 0.
