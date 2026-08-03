# V2-6 main-turn instrumentation — 3 concurrent workers

Generated (UTC): 2026-08-03T14:02:16.520Z
Procedure: `SUPERLIORA_V2_6_REPORT=1 pnpm -C packages/agent-core exec vitest run test/tools/job-main-turn-instrumentation.test.ts`
Budget (checklist V2-6): main-turn wall-clock max ≤ 3000ms

## Result

- ops measured: 14
- max: 4.38ms (budget 3000ms) — PASS
- mean: 0.38ms
- p95: 4.38ms
- concurrent demo workers: 3 (staged ~250ms each); still active for 14/14 ops
- background spawns via JobCreate pump: 3

## Per-op samples

| # | op | target | wall-clock ms | workers active after op |
|---|---|---|---|---|
| 1 | JobCreate | create-1 | 0.55 | 3 |
| 2 | JobCreate | create-2 | 0.09 | 3 |
| 3 | JobCreate | create-3 | 0.07 | 3 |
| 4 | JobList | list-1 | 4.38 | 3 |
| 5 | JobList | list-2 | 0.01 | 3 |
| 6 | JobList | list-3 | 0.02 | 3 |
| 7 | JobList | list-4 | 0.01 | 3 |
| 8 | JobInspect | job_msdat8p42rjuz1 | 0.01 | 3 |
| 9 | JobInspect | job_msdat8p51h8d22 | 0.00 | 3 |
| 10 | JobInspect | job_msdat8p52bvdfq | 0.00 | 3 |
| 11 | JobSteer | job_msdat8p42rjuz1 | 0.06 | 3 |
| 12 | JobSteer | job_msdat8p51h8d22 | 0.01 | 3 |
| 13 | JobSteer | job_msdat8p52bvdfq | 0.01 | 3 |
| 14 | MergeJob | job_msdat8pc4l6e8y | 0.04 | 3 |
