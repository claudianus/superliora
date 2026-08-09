# Visual QA / Independent Review — Skip exhausted Qwen quota for worker models

- **Reviewer role**: Evidence Collector (Maker≠Checker)
- **Branch**: `liora/conductor-jmslpuios3fhu9m`
- **Tip**: `eb64d50396966a81c8fb2ccad06c0b9a4ba96e61`
- **Date**: 2026-08-09 (local review run)
- **Verdict**: **PASS** (wiring + focused tests green; residual risks non-blocking)

## Scope inspected

| Path | Role |
|---|---|
| `packages/oauth/src/credential-health.ts` | Bridge: `applyUsageSnapshotsToCredentialHealth`, `markQuotaExhausted` |
| `packages/oauth/src/provider-usage/provider-usage-fetch-qwen.ts` | Snapshot source (headers / 429 text) |
| `packages/node-sdk/src/auth.ts` | `getAllProvidersUsage` apply |
| `apps/liora/src/tui/controllers/usage/usage-monitor.ts` | TUI poll second apply |
| `packages/agent-core/src/agent/routing/smart-router.ts` | `isConfigAliasHealthy` → store |
| `packages/agent-core/src/session/subagent/subagent-model-routing.ts` | Worker selection via `resolveSmartRoute` |
| `apps/liora/src/tui/components/chrome/footer/footer-badges.ts` | Footer quota badge (unchanged) |
| `apps/liora/src/tui/components/messages/usage-panel/provider-quota.ts` | `/usage` panel (unchanged) |

## VerifySurface axes

| Axis | Result | Evidence |
|---|---|---|
| **load** | N/A | No URL/HTML surface in this change set |
| **interaction** | N/A | No browser affordance; routing is process-local |
| **craft** | PASS (no regression) | Diff adds invisible health bridge only; footer/`/usage` markup/copy untouched |
| **Browser VerifySurface** | Skipped | No runnable HTML path; TUI ANSI not a Browser* target |

Visual surface residual: users still only see existing quota % badge / provider quota bars. There is **no** new TUI cue that workers skipped an exhausted plan (product gap, not a craft regression).

## Falsifiable checks

| # | Check | Result | How |
|---|---|---|---|
| 1 | Focused unit suite | **PASS** | `node scripts/test-local.mjs packages/oauth/test/credential-health.test.ts packages/agent-core/test/session/subagent-model-routing.test.ts packages/agent-core/test/agent/routing/smart-router.test.ts` → 3 files, **33 tests**, `test-local: PASS in 4.4s` |
| 2 | used≥limit → unavailable | **PASS** | `credential-health.test.ts` marks `qwen-token-plan` `rate_limited` + `quota_exhausted`, cooldown `DEFAULT_QUOTA_COOLDOWN_MS` |
| 3 | auth_rejected not clobbered | **PASS** | same suite |
| 4 | under-limit clears only quota_exhausted | **PASS** | same suite |
| 5 | smart-router skips exhausted qwen | **PASS** | `smart-router.test.ts` → `cheap-haiku` |
| 6 | subagent skips exhausted qwen | **PASS** | `subagent-model-routing.test.ts` → `opus` |
| 7 | providerKey allowlist matches fetch | **PASS** | `QUOTA_HEALTH_PROVIDER_KEYS` ≡ `fetchProviderUsage` qwen branch keys |
| 8 | Dual apply paths present | **PASS** | SDK `getAllProvidersUsage` + `UsageMonitorController.poll` |
| 9 | Live TUI poll → worker spawn E2E | **UNCHECKED** | No live process / ANSI capture in this review |
| 10 | Full `pnpm run gate` | **UNCHECKED** | Out of focused review budget |

## Findings (severity)

1. **Medium — RPM / window headers can look like plan quota**  
   `fetchQwenTokenPlanUsage` may emit `Requests` / `Tokens/min` rows from `x-ratelimit-*`. Bridge treats **any** `used >= limit` row as plan exhaustion → `markQuotaExhausted` (~1h). A short rate window can therefore park the whole provider for an hour until a later under-limit snapshot clears it (poll ~90s helps, but cooldown is still 1h if every poll still shows a saturated window row).  
   **Repro (logic):** snapshot with `limits: [{ label: 'Requests', used: 60, limit: 60 }]` + token plan headroom elsewhere → `isProviderUsageQuotaExhausted` true.  
   **Owner:** engineering (narrow exhausted rows to dashscope / plan labels, or shorter cooldown for non-plan rows).

2. **Low — Integration seam only unit-tested in pieces**  
   Tests call `markQuotaExhausted` or `applyUsageSnapshotsToCredentialHealth` separately from `getAllProvidersUsage` / UsageMonitor. No single test asserts SDK aggregate → store → `resolveSmartRoute` in one process.  
   **Owner:** engineering (optional glue test).

3. **Low — Silent catch on bridge**  
   Both call sites swallow bridge throws. Correct for UI path; observability gap if apply ever breaks.  
   **Owner:** engineering (debug log optional).

4. **Info — No routing-skip UI affordance**  
   Footer still `Quota N%`; panel still shows bars/errors. Workers skipping qwen is invisible. Not a regression (no UI diff).  
   **Owner:** product (if user-visible skip reason is desired).

5. **Info — Known gap retained**  
   Timeout / no-header snapshots do not mark exhaustion (only clear quota text or used/limit). Parent already documented; confirmed in `provider-usage-fetch-qwen.ts` catch path (`Request timed out.` does not match `QUOTA_ERROR_RE`).

## Non-findings (checked OK)

- Explicit role override degrades via unhealthy chain (`smart-router` lines 219–245).
- Live `auth_rejected` / `expired` not overwritten by usage bridge.
- Clear path requires successful under-limit snapshot and only clears `failureReason === quota_exhausted`.
- Changeset `.changeset/quota-usage-health-bridge.md` present (minor oauth / patch others).
- `premium.ts` / `assistant-message.ts` / `upstream.lock` untouched (as claimed).

## Required fixes for ship

None for **PASS**. Medium finding is residual product risk, not a broken wiring proof.

## Publishable tip

- **branch**: `liora/conductor-jmslpuios3fhu9m`
- **sha**: `eb64d50396966a81c8fb2ccad06c0b9a4ba96e61` (+ this review report commit if landed)
- **remote_ref**: parent PushJob / PR only (worker does not push)

```json
{
  "verdict": "pass",
  "findings": [
    {
      "severity": "medium",
      "id": "rpm-row-as-plan-quota",
      "summary": "Any used>=limit usage row (including short RPM windows) marks ~1h quota_exhausted",
      "location": "packages/oauth/src/credential-health.ts#isProviderUsageQuotaExhausted + provider-usage-fetch-qwen.ts"
    },
    {
      "severity": "low",
      "id": "no-e2e-glue",
      "summary": "SDK/TUI poll → health → route not covered by one integration test",
      "location": "packages/node-sdk/src/auth.ts, apps/liora/.../usage-monitor.ts"
    },
    {
      "severity": "low",
      "id": "silent-bridge-catch",
      "summary": "Bridge errors swallowed at both apply sites",
      "location": "auth.ts getAllProvidersUsage, usage-monitor.ts poll"
    },
    {
      "severity": "info",
      "id": "no-skip-ui",
      "summary": "No TUI cue that workers skipped exhausted plan; craft unchanged",
      "location": "footer-badges.ts, usage-panel/provider-quota.ts"
    },
    {
      "severity": "info",
      "id": "timeout-no-mark",
      "summary": "Timeout without quota text does not mark exhaustion",
      "location": "provider-usage-fetch-qwen.ts"
    }
  ],
  "required_fixes": [],
  "verify_surface": {
    "load": "n/a",
    "interaction": "n/a",
    "craft": "pass_no_regression",
    "browser_run": false,
    "reason": "no URL/HTML path; TUI-only invisible bridge"
  },
  "tests": {
    "command": "node scripts/test-local.mjs packages/oauth/test/credential-health.test.ts packages/agent-core/test/session/subagent-model-routing.test.ts packages/agent-core/test/agent/routing/smart-router.test.ts",
    "result": "33 passed / 3 files / PASS 4.4s"
  }
}
```
