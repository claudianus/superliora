# Visual QA / Independent Review — Smart auto routing skip exhausted models

- **Reviewer role**: Evidence Collector (Maker≠Checker, visual-qa)
- **Parent job**: `job_mslr8u0h34nj4y`
- **Checker worktree branch**: `liora/conductor-jmslr8u0h34nj4y`
- **Checker tip**: `ae9db3f06ef2d31e1950d6286d8e85dc3b7ed6e0`
- **Date**: 2026-08-09 (local review run)
- **Verdict**: **FAIL** (required fix not present on this worktree HEAD)

## Scope inspected (read-first list + call sites)

| Path | Observed on this HEAD |
|---|---|
| `apps/liora/src/tui/utils/model/loop-model-routing.ts` | Preview rows only; no quota bridge |
| `apps/liora/src/tui/commands/config/model/model.ts` | Smart auto clears role overrides; no health write |
| `packages/agent-core/src/utils/model-presets.ts` | `previewLoopRoleModelRouting` / `autoAssignRoleModelsWithHealth` respect `available` |
| `packages/agent-core/src/agent/routing/smart-router.ts` | `isConfigAliasHealthy` → `sharedCredentialHealthStore.isAvailable` |
| `packages/oauth/src/credential-health.ts` | Store + annotate only — **no** `applyUsageSnapshotsToCredentialHealth` / `markQuotaExhausted` |
| `apps/liora/src/tui/controllers/usage/usage-monitor.ts` | Poll sets `providerQuota` only — **no** health apply |
| `packages/node-sdk/src/auth.ts` `getAllProvidersUsage` | Returns aggregate only — **no** health apply |
| `packages/oauth/src/provider-usage/provider-usage-fetch-qwen.ts` | Can emit 429 / RPM / dashscope rows (source signal exists) |
| `apps/liora/test/tui/utils/loop-model-routing.test.ts` | No exhausted-provider case |
| `packages/agent-core/test/utils/model-presets.test.ts` | Skips `available:false` only when pre-flagged |
| `packages/agent-core/test/agent/routing/smart-router.test.ts` | Health via missing provider / OAuth token; **no** quota-exhausted case |
| `packages/oauth/test/credential-health.test.ts` | Cache-key tests only (36 lines) |

## Sibling fix (not on this HEAD)

| Item | Evidence |
|---|---|
| Fix commit | `eb64d50396966a81c8fb2ccad06c0b9a4ba96e61` — `fix(oauth): bridge usage quota into credential health routing` |
| Contained by | `liora/conductor-jmslpuios3fhu9m` only (`git branch -a --contains eb64d5039`) |
| Ancestor of this HEAD? | **No** (`git merge-base --is-ancestor eb64d5039 HEAD` → exit 1) |
| Sibling tip | `f92ef11de6fee7d63d2f2ed7959ff703679f9a79` |
| Bridge symbols on this HEAD | `rg applyUsageSnapshotsToCredentialHealth\|markQuotaExhausted\|QUOTA_EXHAUSTED` → **NO MATCHES** |

Sibling wiring (for parent/engineering land, not present here):

1. `CredentialHealthStore.markQuotaExhausted` + `applyUsageSnapshotsToCredentialHealth`
2. `packages/node-sdk/src/auth.ts` `getAllProvidersUsage` applies bridge after aggregate
3. `UsageMonitorController.poll` second apply
4. Tests: credential-health bridge suite + smart-router / subagent skip cases

## VerifySurface axes

| Axis | Result | Evidence |
|---|---|---|
| **load** | N/A | No URL/HTML surface for this routing change |
| **interaction** | N/A | No browser affordance |
| **craft** | N/A (no UI delta on this HEAD) | Invisible routing health path; footer/`/usage` not modified here |
| **Browser VerifySurface** | Skipped | No runnable HTML path; TUI ANSI not a Browser* target |

## Falsifiable checks

| # | Check | Result | How |
|---|---|---|---|
| 1 | Bridge APIs exported on HEAD | **FAIL** | `packages/oauth/src/credential-health.ts` exports stop at `annotateModelsWithCredentialHealth`; no `applyUsage…` / `markQuotaExhausted` |
| 2 | UsageMonitor bridges quota → health | **FAIL** | `usage-monitor.ts` poll: `getAllProvidersUsage` → `setAppState({ providerQuota })` only |
| 3 | SDK `getAllProvidersUsage` bridges | **FAIL** | `packages/node-sdk/src/auth.ts` ~294+ builds aggregate, returns without health apply |
| 4 | smart-router can skip if store marked | **PASS (partial)** | `isConfigAliasHealthy` calls `sharedCredentialHealthStore.isAvailable`; store has `markRateLimited` |
| 5 | Proactive mark from usage snapshots | **FAIL** | No caller marks quota from usage on this HEAD |
| 6 | Focused unit suite | **BLOCKED** | `node scripts/test-local.mjs …` → `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found`; worktree has **no** `node_modules` |
| 7 | Sibling fix green (prior report) | **PASS (elsewhere)** | Prior report on sibling: 33 tests green at `eb64d5039` — **not** re-run here |
| 8 | Live TUI poll → worker spawn E2E | **UNCHECKED** | No process / ANSI capture |

## Findings (severity)

1. **Critical — Required fix not on review HEAD**  
   Parent job intent: smart auto must skip quota-exhausted `qwen-token-plan` **before** API failure. On `liora/conductor-jmslr8u0h34nj4y` @ `ae9db3f06`, usage snapshots never write credential health, so auto routing still treats credentialed qwen aliases as available until a live 401/429 path marks the store.  
   **Repro (static):** open `usage-monitor.ts` poll + `auth.ts` `getAllProvidersUsage` — no `applyUsageSnapshotsToCredentialHealth`.  
   **Owner:** parent orchestrator / engineering — land or cherry-pick `eb64d5039` (branch `liora/conductor-jmslpuios3fhu9m`) onto the product worktree, not this checker tree alone.

2. **High — Missing regression tests on this HEAD**  
   HEAD `smart-router.test.ts` has no `markQuotaExhausted` / exhausted-qwen case; HEAD `credential-health.test.ts` is cache-key only. Sibling has the coverage; this tree does not.  
   **Owner:** engineering (land with fix).

3. **Medium — No install / tests unrunnable in this worktree**  
   `NO_NODE_MODULES`; `test-local` cannot exec vitest. Cannot green-check runtime behavior here.  
   **Owner:** parent (install deps or review on a provisioned worktree).

4. **Medium (sibling residual, not on this HEAD)** — Prior checker on sibling: RPM/`Requests` used≥limit can look like plan quota (~1h). Re-verify after land.

5. **Info — No routing-skip UI affordance**  
   Even with sibling fix, users only see existing quota badge/panel; worker skip reason is invisible. Product gap, not craft regression.

## Required fixes for ship

1. Merge/cherry-pick usage→credential-health bridge (`applyUsageSnapshotsToCredentialHealth` + dual call sites) from `liora/conductor-jmslpuios3fhu9m` / `eb64d5039` into the product branch under review.
2. Include sibling unit coverage (credential-health bridge + smart-router skip + subagent routing).
3. Re-run focused tests after `pnpm install` (or provisioned tree):  
   `node scripts/test-local.mjs packages/oauth/test/credential-health.test.ts packages/agent-core/test/session/subagent-model-routing.test.ts packages/agent-core/test/agent/routing/smart-router.test.ts`

## Non-findings (checked OK on this HEAD)

- Smart router **does** consult `sharedCredentialHealthStore` when a mark exists (`isConfigAliasHealthy`).
- Explicit unhealthy overrides degrade / fall through to auto (`smart-router.ts` explicit path).
- `sharedCredentialHealthStore` is exported from `@superliora/oauth`.
- Meeting-notes parent handoff correctly deferred implement work; this checker confirms implement is still missing **here**.

## Publishable tip

- **branch**: `liora/conductor-jmslr8u0h34nj4y`
- **sha**: (this report commit tip after land)
- **base reviewed**: `ae9db3f06ef2d31e1950d6286d8e85dc3b7ed6e0`
- **fix lives on**: `liora/conductor-jmslpuios3fhu9m` @ `f92ef11de` (bridge commit `eb64d5039`)
- **remote_ref**: parent PushJob / PR only (worker does not push)

```json
{
  "verdict": "fail",
  "findings": [
    {
      "severity": "critical",
      "id": "bridge-missing-on-head",
      "summary": "usage→credential-health bridge (applyUsageSnapshotsToCredentialHealth / markQuotaExhausted) absent on this worktree; smart auto cannot proactively skip exhausted qwen-token-plan",
      "location": "packages/oauth/src/credential-health.ts, packages/node-sdk/src/auth.ts#getAllProvidersUsage, apps/liora/src/tui/controllers/usage/usage-monitor.ts"
    },
    {
      "severity": "high",
      "id": "missing-regression-tests",
      "summary": "No quota-exhausted smart-router / credential-health bridge tests on this HEAD",
      "location": "packages/oauth/test/credential-health.test.ts, packages/agent-core/test/agent/routing/smart-router.test.ts"
    },
    {
      "severity": "medium",
      "id": "tests-unrunnable",
      "summary": "Worktree has no node_modules; test-local fails with vitest not found",
      "location": "worktree root"
    },
    {
      "severity": "medium",
      "id": "sibling-rpm-as-plan-quota",
      "summary": "On sibling fix only: any used>=limit row may mark ~1h quota_exhausted",
      "location": "sibling packages/oauth/src/credential-health.ts + provider-usage-fetch-qwen.ts"
    },
    {
      "severity": "info",
      "id": "no-skip-ui",
      "summary": "No TUI cue that workers skipped exhausted plan",
      "location": "footer / usage panel (unchanged)"
    }
  ],
  "required_fixes": [
    "Land eb64d5039 (or equivalent) usage→health bridge onto product branch under review",
    "Land sibling regression tests for exhausted qwen skip",
    "Re-run focused test-local after dependency install"
  ],
  "verify_surface": {
    "load": "n/a",
    "interaction": "n/a",
    "craft": "n/a",
    "browser_run": false,
    "reason": "no URL/HTML path; routing health bridge is process-local; nothing to screenshot on this HEAD"
  },
  "tests": {
    "command": "node scripts/test-local.mjs packages/oauth/test/credential-health.test.ts packages/agent-core/test/agent/routing/smart-router.test.ts apps/liora/test/tui/utils/loop-model-routing.test.ts packages/agent-core/test/utils/model-presets.test.ts",
    "result": "FAIL env: vitest not found (no node_modules)"
  }
}
```
