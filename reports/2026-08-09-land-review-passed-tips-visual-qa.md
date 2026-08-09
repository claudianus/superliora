# Visual QA / Independent Review — Land review-passed tips

- **Reviewer role**: Evidence Collector (Maker≠Checker, visual-qa)
- **Parent job**: `job_msmap7vz1he403` — Land review-passed tips fast and push
- **Checker worktree**: `liora/conductor-jmsmap7vz1he403` @ `70d1d692603e6e5b5cf908e113b804feaa42b6e2` (no merge commits; land is on main checkout)
- **Land surface under review**: `/Users/modumaru/Desktop/code/superliora` branch `main` @ `3fa0dbb0ce7143b01a32ef5055d74d6a82dc6a8d`
- **Date**: 2026-08-09 (local independent check)
- **Verdict**: **PASS** (local land + focused UI/unit evidence green; remote publish still open for parent PushJob)

## Scope inspected

| Item | Result |
|---|---|
| Local `main` HEAD | `3fa0dbb0ce7143b01a32ef5055d74d6a82dc6a8d` |
| `origin/main` | `70d1d692603e6e5b5cf908e113b804feaa42b6e2` (still base; **not** pushed) |
| Ancestors on local main | `b9359fee0` YES · `9d08759a5` YES · `944dcd0b8` YES · `89cec7666` YES |
| Excluded `f49389b42` | local NO · origin NO |
| HTML/site/vis deltas in `70d1d6926..3fa0dbb0c` | **none** |

### Landed UI-relevant tips

| Tip / merge | Surface | Files |
|---|---|---|
| `8c153bc99` ← `b9359fee0` (+ `21ae55267`) | TUI theme boot Neon Noir | `theme/colors.ts`, `theme/theme.ts`, `theme/index.ts`, tests |
| `4f7116355` ← `9d08759a5` | Worker Dock densemode calm fails / drop TAPE·BOARD | `mission-control/densemode.ts`, `panel.ts`, `registry.ts`, tests |
| `db307fefa` ← `944dcd0b8` | smart auto routing (logic + i18n strings) | model routing / presets — no HTML |
| `3fa0dbb0c` ← `89cec7666` | Conductor explore-cap | agent-core only — no UI paint |

## VerifySurface axes

| Axis | Result | Evidence |
|---|---|---|
| **load** | **N/A** | Land range has zero `.html` / `apps/site` / `apps/vis` path deltas |
| **interaction** | **N/A** | No browser affordance in landed set |
| **craft** | **Partial (TUI, non-browser)** | Neon Noir palette + Worker Dock densemode reviewed via source + unit paint tests; **no live TUI ANSI frame captured** |
| **Browser VerifySurface** | **Skipped (blocked by surface type)** | No runnable URL/HTML path for this land; TUI is not a Browser* target |

## Falsifiable checks

| # | Check | Result | How |
|---|---|---|---|
| 1 | Local HEAD equals claimed SHA | **PASS** | `git rev-parse main` → `3fa0dbb0ce7143b01a32ef5055d74d6a82dc6a8d` |
| 2 | Four tips ancestors of local main | **PASS** | `merge-base --is-ancestor` YES ×4 |
| 3 | `f49389b42` not on local/origin main | **PASS** | ancestor NO / NO |
| 4 | `origin/main` still pre-land base | **PASS (publish incomplete)** | `70d1d6926…` |
| 5 | No HTML/site surface in land | **PASS** | `git diff --name-only 70d1d6926..3fa0dbb0c` → no html/site/vis |
| 6 | Neon Noir boot singleton tests | **PASS** | `node scripts/test-local.mjs apps/liora/test/tui/theme/index.test.ts apps/liora/test/tui/config.test.ts` → **22/22** |
| 7 | usage-panel theme pin | **PASS** | `…/usage-panel.test.ts` → **13/13** |
| 8 | Worker Dock densemode / panel / registry | **PASS** | densemode + panel + registry → **42/42** (8+17+17) |
| 9 | loop-model-routing + conductor guard/delegation | **PASS** | routing 7 + guard 69 + delegation 5 = **81** in combined run; total focused green **123** across 6 files in first batch |
| 10 | Live TUI dock/theme screenshot | **UNCHECKED** | No ANSI/TUI capture harness run in this review |
| 11 | Full `pnpm run gate` | **UNCHECKED** | Timebox; focused suites only |

### Neon Noir contrast (computed, WCAG relative luminance vs `#0D1422`)

| Token | Hex | Ratio | Note |
|---|---|---|---|
| text | `#E6EDF3` | 15.59 | AA body pass |
| textDim | `#9AA7B2` | 7.49 | AA body pass |
| textMuted | `#6F7A86` | **4.21** | &lt; 4.5 body; large-text band only |
| primary | `#00D5FF` | 10.49 | pass |
| error / success / warning / accent | — | ≥ 6.19 | pass |

## Findings (severity)

1. **Medium — No live TUI visual proof for dock/theme land**  
   Worker Dock layout (workers-only, calm `textDim` fails, no TAPE/BOARD) and Neon Noir boot are covered by unit string/palette tests only. Premium visual DoD for user-visible TUI still lacks a captured terminal frame.  
   **Repro gap:** no ANSI artifact under `reports/` for this land.  
   **Owner:** engineering / parent optional follow-up (TUI frame harness), not a land-revert.

2. **Low — `textMuted` body contrast 4.21:1 on Neon Noir canvas**  
   Against product default `#0D1422`, `#6F7A86` misses WCAG AA 4.5:1 for normal body text. Matches bundled Neon Noir intent; counters/meta use-case is mostly chrome.  
   **Owner:** product/design if AA body is required for muted copy.

3. **Info — Failed workers/jobs painted `textDim` not `error` in dock KPI**  
   Intentional calm chrome (`densemode.ts` KPI / job-fail chips). Severity signal moved away from error red; operators may under-read failures if they relied on dock chrome alone. Unit tests assert new behavior.  
   **Owner:** product (accepted trade-off) unless ops reports miss-rate.

4. **High (publish, not visual craft) — `origin/main` not advanced**  
   Local `main` is 11 commits ahead of `origin/main`; four tips are **not** remote ancestors. Parent success criterion “push” remains open.  
   **Owner:** parent / PushJob — ff-only push of `3fa0dbb0c` from `/Users/modumaru/Desktop/code/superliora`.

5. **Info — Checker job worktree is stale relative to land**  
   `liora/conductor-jmsmap7vz1he403` HEAD is still `70d1d6926`. Review of landed bytes was performed against the main checkout path, not this worktree tree.

## Pass/fail matrix (visual-qa DoD)

| Criterion | Verdict |
|---|---|
| Maker≠Checker independent re-check of claimed land SHAs | **PASS** |
| Excluded tip not present | **PASS** |
| Browser VerifySurface when HTML available | **N/A** (none) |
| Focused UI/unit suites green | **PASS** |
| Live screenshot of TUI dock/theme | **GAP** (not fail land) |
| Remote publish complete | **FAIL open** (parent PushJob) |

## Recommendations

1. **[parent / PushJob]** Push local `main` @ `3fa0dbb0ce7143b01a32ef5055d74d6a82dc6a8d` → `origin/main` (ff-only, no force). Confirm with `git rev-parse origin/main`.
2. **[parent optional]** Capture one Worker Dock densemode ANSI + Neon Noir boot frame for premium evidence ledger.
3. **[design optional]** Raise `textMuted` if AA body is required on default theme.
4. **Do not** treat this checker worktree as the land tip for PushJob — use main checkout SHA above.

## Verification receipts

```text
# SHAs
main / HEAD: 3fa0dbb0ce7143b01a32ef5055d74d6a82dc6a8d
origin/main: 70d1d692603e6e5b5cf908e113b804feaa42b6e2

# Ancestors (local main)
b9359fee0 YES; 9d08759a5 YES; 944dcd0b8 YES; 89cec7666 YES; f49389b42 NO

# Tests (CI-parity via scripts/test-local.mjs on main checkout)
mission-control densemode+panel+registry + loop-model-routing + conductor-guard + conductor-delegation
  → 6 files, 123 passed
theme/index + config → 2 files, 22 passed
usage-panel → 1 file, 13 passed
```

## JSON

```json
{
  "verdict": "pass",
  "findings": [
    {
      "severity": "medium",
      "id": "no-live-tui-frame",
      "summary": "Worker Dock + Neon Noir land has unit proof only; no live TUI ANSI/screenshot for craft axis.",
      "evidence": "70d1d6926..3fa0dbb0c has no HTML; Browser VerifySurface N/A; tests paint/palette only"
    },
    {
      "severity": "low",
      "id": "textmuted-contrast",
      "summary": "Neon Noir textMuted #6F7A86 vs background #0D1422 contrast 4.21 (< 4.5 AA body).",
      "evidence": "relative-luminance calc on neonNoirColors tokens"
    },
    {
      "severity": "info",
      "id": "dock-fail-calm",
      "summary": "Failed workers/jobs use textDim in dock KPI instead of error — intentional declutter, lower severity chrome.",
      "evidence": "apps/liora/src/tui/components/panes/mission-control/densemode.ts buildKpiLine / formatMissionJobCounts"
    },
    {
      "severity": "high",
      "id": "origin-main-not-pushed",
      "summary": "Four tips are local main ancestors only; origin/main remains 70d1d6926.",
      "evidence": "git rev-parse origin/main; merge-base --is-ancestor tips origin/main → NO"
    },
    {
      "severity": "info",
      "id": "checker-worktree-stale",
      "summary": "Job worktree liora/conductor-jmsmap7vz1he403 still at 70d1d6926; land lives on main checkout.",
      "evidence": "git rev-parse in worktree vs Desktop/code/superliora main"
    }
  ],
  "required_fixes": [],
  "verify_surface": {
    "load": "n/a",
    "interaction": "n/a",
    "craft": "partial-tui-unit-only",
    "browser_run": "skipped-no-html-path"
  },
  "publishable": {
    "path": "/Users/modumaru/Desktop/code/superliora",
    "branch": "main",
    "sha": "3fa0dbb0ce7143b01a32ef5055d74d6a82dc6a8d",
    "remote_ref": "main",
    "push_status": "not_done_needs_PushJob"
  }
}
```
