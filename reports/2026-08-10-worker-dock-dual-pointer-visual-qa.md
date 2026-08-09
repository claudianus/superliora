# Visual QA / Independent Review — Worker Dock dual-pointer hover

- **Reviewer role**: Evidence Collector (Maker≠Checker) · visual-qa
- **Branch**: `liora/conductor-jmsmap7wo3ftqjq`
- **Tip reviewed**: `64c25ca70` (`fix(liora): dual-pointer dock hover uses distinct pad`)  
  worktree HEAD at review: `e6f54530a` (snapshot chore atop the fix)
- **Date**: 2026-08-10 (local review run)
- **Verdict**: **PASS** (D1 dual-pointer fixed; same-frame paint evidence + scoped tests green)

## Scope inspected

| Path | Role |
|---|---|
| `apps/liora/src/tui/features/mission-control/worker-row-paint.ts` | Selected `❯` vs hover-only `·` chrome |
| `apps/liora/src/tui/features/mission-control/worker-hover.ts` | Single active hover region |
| `apps/liora/src/tui/features/mission-control/worker-dock-mouse.ts` | Mouse hover → region + click open |
| `apps/liora/src/tui/components/panes/mission-control/densemode.ts` | Fixed 2-col gutter when chrome wired; BOARD job `❯` |
| `apps/liora/src/tui/components/panes/mission-control/panel.ts` | densemode `paintRowChrome` wiring |
| `apps/liora/test/tui/features/mission-control-hover.test.ts` | Chrome unit + same-frame dual-pointer |
| `apps/liora/test/tui/components/mission-control-panel.test.ts` | Full panel same-frame render assertion |
| `.changeset/worker-dock-dual-pointer.md` | minor `@superliora/liora` |

## VerifySurface axes

| Axis | Result | Evidence |
|---|---|---|
| **load** | N/A | No URL/HTML surface — Mission Control is native TUI |
| **interaction** | N/A (browser) | Browser* / VerifySurface HTML path not applicable |
| **craft** | **PASS** (D1) | Same-frame paint dump: one `❯` on selected worker, `·` pad on hovered worker |
| **Browser VerifySurface** | Skipped | Terminal ANSI only; see paint dump artifacts below |

### Paint dump (plain, CI-parity)

Artifact: `reports/2026-08-10-worker-dock-dual-pointer-paint-plain.txt`  
Raw ANSI: `reports/2026-08-10-worker-dock-dual-pointer-paint-raw.ansi`

```
  ╭ Worker Dock · 2 workers · 150 tok · 2s ──…╮
  │ FLEET 2 · Σ150 · wall 2s                  │
  │ WKR      ST MODEL    ELAP TOOLS   TOK …   │
  │ ❯ ● sel-a    —         02s     2    100 … │
  │ · ● hov-b    —         01s     1     50 … │
  │  Enter open · Esc back · click select     │
  ╰───────────────────────────────────────────╯
```

Meta: `pointerCount=1`, `selHasPointer=true`, `hovHasPointer=false`, `hovHasPad=true`.

## Falsifiable checks

| # | Check | Result | How |
|---|---|---|---|
| 1 | Scoped mission-control suite | **PASS** | `node scripts/test-local.mjs apps/liora/test/tui/components/mission-control-panel.test.ts apps/liora/test/tui/features/mission-control-hover.test.ts` → **2 files / 24 tests**, `test-local: PASS in 5.0s` (CI-parity) |
| 2 | Hover chrome ≠ `SELECT_POINTER` | **PASS** | `mission-control-hover.test.ts` + paint dump |
| 3 | Same-frame selected + different-row hover → one `❯` | **PASS** | unit chrome + panel `render(100)` assertions + paint dump meta |
| 4 | densemode fixed 2-col gutter when chrome wired | **PASS** | `densemode.ts` idle → `'  '`; paint dump columns align across sel/hover rows |
| 5 | Selected wins over hover on same row | **PASS** | `paintWorkerRowChrome` returns selected branch before hover |
| 6 | Live interactive TUI / mouse E2E | **UNCHECKED** | No live process; unit paint + mouse handler code review only |
| 7 | Full `pnpm -C apps/liora run test` / `pnpm run gate` | **UNCHECKED** | worktree `node_modules` → sibling worktree symlink (`conductor-jmslrcf2l3gr80w`); parent already reported cross-path TS noise |
| 8 | Browser VerifySurface | **N/A** | No HTML URL |

## Findings (severity)

1. **Info — BOARD attention still uses `SELECT_POINTER` per job card**  
   `densemode.ts` ~295 prefixes attention job rows with `❯`. When BOARD strip is visible **and** a worker is selected, the same frame can show worker `❯` + job-card `❯`. This is **not** the D1 dual-worker-row bug (selected+hover both `❯` on WKR list).  
   **Repro:** densemode with jobs snapshot + selected worker.  
   **Owner:** product/engineering if PREMIUM “one cursor” is global across strips; out of D1 brief if limited to worker rows.

2. **Info — SPARK idle glyph shares `·` with hover pad**  
   `formatRateSparkline` empty samples use `'·'.repeat(width)`; hover chrome is also `HOVER_ROW_PAD='·'`. Positions differ (gutter vs SPARK column); paint dump still readable. Weak visual language collision only.  
   **Owner:** engineering (optional distinct hover glyph) if craft pass tightens.

3. **Info — Live terminal not re-captured**  
   Evidence is unit `panel.render()` under CI-parity (`NO_COLOR` / motion off), not an interactive mouse session. Mouse path reviewed in `worker-dock-mouse.ts` (hover sets region, click selects + opens transcript).  
   **Owner:** parent/ops if live ANSI re-capture required.

4. **Info — Env symlink residual**  
   Root/`apps/liora` `node_modules` → sibling worktree. Scoped tests green; full package suite not re-run here.  
   **Owner:** parent/ops (`pnpm install` in-worktree, drop cross-worktree links).

5. **Info — D2 keyboard first bare ↑/↓ focus gate**  
   Parent correctly scoped out; not re-litigated. Still open product gap.

## Non-findings (checked OK)

- D1 root cause fix: hover-only never paints `SELECT_POINTER`; selected uses bold/pulse `❯`.
- Single hover region (`setHoverRegion` replaces id).
- Changeset present (`minor` on `@superliora/liora`).
- Panel densemode always wires `paintRowChrome` → fixed gutter reserved.
- Scoped 24/24 re-verified by this checker (not trusted from maker alone).

## Required fixes for ship

None for **PASS** against the dual-pointer success criteria.

## Artifacts

| File | Purpose |
|---|---|
| `reports/2026-08-10-worker-dock-dual-pointer-visual-qa.md` | This review |
| `reports/2026-08-10-worker-dock-dual-pointer-paint-plain.txt` | Plain paint + meta |
| `reports/2026-08-10-worker-dock-dual-pointer-paint-raw.ansi` | Raw ANSI frame |

## Publish coordinates (PushJob)

- **branch**: `liora/conductor-jmsmap7wo3ftqjq`
- **fix commit**: `64c25ca70`
- **suggested remote_ref**: `liora/conductor-jmsmap7wo3ftqjq`
- This checker does **not** push.

```json
{
  "verdict": "pass",
  "findings": [
    {
      "id": "D1-fixed",
      "severity": "info",
      "title": "Worker-row dual ❯ fixed; same-frame paint proves one SELECT_POINTER + hover pad",
      "evidence": [
        "reports/2026-08-10-worker-dock-dual-pointer-paint-plain.txt",
        "node scripts/test-local.mjs … → 24/24 PASS"
      ]
    },
    {
      "id": "BOARD-SELECT_POINTER",
      "severity": "info",
      "title": "BOARD attention cards still paint ❯ (second pointer surface when jobs visible)",
      "location": "apps/liora/src/tui/components/panes/mission-control/densemode.ts:295"
    },
    {
      "id": "SPARK-glyph-collision",
      "severity": "info",
      "title": "SPARK idle · shares glyph with HOVER_ROW_PAD",
      "location": "formatRateSparkline empty path + HOVER_ROW_PAD"
    },
    {
      "id": "live-tui-unchecked",
      "severity": "info",
      "title": "No live interactive mouse/TUI capture; unit paint only"
    },
    {
      "id": "env-symlink",
      "severity": "info",
      "title": "node_modules symlink to sibling worktree; full suite not re-run"
    }
  ],
  "required_fixes": []
}
```
