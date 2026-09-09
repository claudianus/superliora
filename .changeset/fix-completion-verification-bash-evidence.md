---
"@superliora/agent-core": patch
---

Honor worker-run checks in completion verification: the verification sensor now records the last outcome per check slot from live Bash/RunProjectChecks results, and the completion gate reads that evidence when the package-script gate cannot run. A scriptless-project worker that proves its change with a green `node --test` run is no longer labelled `unverified (checks did not run)`, and a worker that ends on a red test run now lands the job `failed` instead of `done`.
