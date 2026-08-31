---
'@superliora/liora': patch
---

Cut per-push CI wall time from ~27 to ~15 minutes: Windows CI runs a Windows-critical subset per push with the full suite moved to a nightly schedule and release tags, and the test-baseline ratchet consumes the unified test run's results JSON instead of re-running vitest. Landing changesets on a green main now ships automatically: the new auto-release workflow versions, commits, tags, and dispatches the native publish pipeline.
