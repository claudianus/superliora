# Code Review — Qwen quota health bridge (Maker≠Checker)

- **Reviewer role**: Code Reviewer (independent checker)
- **Parent job**: `job_mslq36v2ol9wse` (verify tests) / feature tip `eb64d5039`
- **Branch**: `liora/conductor-jmslpuios3fhu9m`
- **HEAD reviewed**: `0e44d14a5664daed8ff184bfbdc6dc104860813e`
- **Feature tip ancestor**: `eb64d50396966a81c8fb2ccad06c0b9a4ba96e61` (`ancestor_ok=yes`)
- **Date**: 2026-08-09T11:44:15Z
- **Verdict**: **PASS**

## Scope

| Path | Reviewed |
|---|---|
| `packages/oauth/src/credential-health.ts` | Bridge + `markQuotaExhausted` |
| `packages/oauth/test/credential-health.test.ts` | Exhaust / clear / auth_rejected guard |
| `packages/oauth/src/index.ts` | Public exports |
| `packages/node-sdk/src/auth.ts` | `getAllProvidersUsage` apply |
| `apps/liora/src/tui/controllers/usage/usage-monitor.ts` | TUI second apply |
| `packages/agent-core` routing readers + tests | Smart route / subagent skip |
| `packages/oauth/src/provider-usage/provider-usage-fetch-qwen.ts` | Snapshot source (unchanged, signal shape) |
| `.changeset/quota-usage-health-bridge.md` | Package bumps |

**Forbidden paths clean**: no touch to `premium.ts` / `assistant-message.ts` / `apps/site` / `meta/upstream.lock.yaml`.

## Correctness

1. **Health mark model** — `markQuotaExhausted` reuses `rate_limited` with `failureReason=quota_exhausted` and `DEFAULT_QUOTA_COOLDOWN_MS` (1h). Readers already treat any non-healthy status with live cooldown as unavailable (`isAvailable`), so no routing API change was required. `isConfigAliasHealthy` → `sharedCredentialHealthStore.isAvailable(providerName)` matches provider-level keys written by the bridge.

2. **Apply rules** (`applyUsageSnapshotsToCredentialHealth`):
   - Token-plan family only (`qwen-token-plan`, `alibaba-token-plan`, `alibaba-token-plan-cn`) — aligns with `fetchProviderUsage` branches.
   - Exhaust: `used >= limit` on summary **or any** limit row, or `QUOTA_ERROR_RE` on error text (covers Qwen 429: `Rate limited — quota may be exhausted.`).
   - Never clobbers live `auth_rejected` / `expired`.
   - Clear path only when prior mark is exactly `rate_limited` + `quota_exhausted` and snapshot is available, error-free, with at least one under-limit row — avoids wiping real auth failures or generic rate limits.

3. **Dual apply (SDK + TUI)** — SDK path is the primary process bridge; TUI second apply is defensive for harness stubs. Idempotent; swallow errors so quota UI never fails closed. Acceptable.

4. **Changeset** — `@superliora/oauth` minor (new public exports), sdk/liora/agent-core patch. Appropriate.

## Independent test re-run

```text
node scripts/test-local.mjs \
  packages/oauth/test/credential-health.test.ts \
  packages/agent-core/test/agent/routing/smart-router.test.ts \
  packages/agent-core/test/session/subagent-model-routing.test.ts
```

| File | Result |
|---|---|
| `packages/oauth/test/credential-health.test.ts` | 13 passed |
| `packages/agent-core/test/agent/routing/smart-router.test.ts` | 13 passed |
| `packages/agent-core/test/session/subagent-model-routing.test.ts` | 7 passed |
| **Total** | **3 files / 33 tests, exit 0** (~4.4s, CI-parity) |

## Findings (non-blocking)

| Severity | Finding | Location | Notes |
|---|---|---|---|
| low | **Any limit row exhaustion marks whole provider** | `credential-health.ts` `usageRowExhausted` loop | Qwen snapshot may include RPM + TPM + plan tokens. RPM-only cap could park the provider for ~1h even if plan tokens remain. Intentional fail-closed for routing; product may later want plan-token-only rows. |
| low | **Timeout / header-less success cannot mark exhaustion** | `provider-usage-fetch-qwen.ts` catch → `Request timed out.`; 200 with no rate headers → `available: false`, empty rows | Documented residual; bridge correctly refuses to invent exhaustion without signal. |
| info | **No unit test on SDK/TUI call sites** | `auth.ts`, `usage-monitor.ts` | Bridge pure function + routing readers covered; wiring is thin try/catch. Optional follow-up mock test. |
| info | **No new TUI cue that workers skipped quota** | footer / `/usage` unchanged | Product gap, not a regression (prior visual QA). |

## Required fixes

None for merge of this change set.

## Residual unchecked

- Full `pnpm run gate` (lint + typecheck + full suite)
- E2E: real UsageMonitor poll → worker spawn path
- Live Alibaba header shapes in production

```json
{
  "verdict": "pass",
  "findings": [
    {
      "severity": "low",
      "id": "any-row-exhaustion",
      "summary": "Any exhausted limit row (e.g. RPM) marks the whole token-plan provider unavailable for ~1h",
      "path": "packages/oauth/src/credential-health.ts"
    },
    {
      "severity": "low",
      "id": "timeout-no-signal",
      "summary": "Usage fetch timeout or header-less 200 cannot mark quota exhaustion",
      "path": "packages/oauth/src/provider-usage/provider-usage-fetch-qwen.ts"
    },
    {
      "severity": "info",
      "id": "no-wiring-unit-test",
      "summary": "SDK/TUI apply call sites lack direct unit tests; pure bridge + routing covered",
      "path": "packages/node-sdk/src/auth.ts"
    }
  ],
  "required_fixes": []
}
```
