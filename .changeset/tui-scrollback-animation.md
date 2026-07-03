---
"@moonshot-ai/kimi-code": patch
---

Keep TUI scrollback stable during animation frames and add the experimental native renderer path with visible scrollbars, native editor controls, adaptive terminal profiles, renderer-owned Text, Markdown, SelectList, combined autocomplete provider, ANSI text utility, key matching, fuzzy search, autocomplete/list contracts, component, focus/cursor, and inline image thumbnail primitives, balanced frame output policies, quality- and health-aware effects, adaptive animation pacing, and an opt-in renderer diagnostics HUD with output policy status. Run /renderer diagnostics with the native renderer experiment enabled to toggle, reset, and inspect the HUD.

Hold automatic renderer facade frames while the transcript viewport is manually scrolled away from the bottom, while preserving explicit manual scroll renders. This applies to the current pi-tui compatibility backend as well as the native renderer path, reducing forced bottom jumps while reading earlier TUI output.

Show a compact footer history badge while the transcript viewport is paused away from live output, using renderer-owned history status projection so users can tell that automatic following is intentionally held.

Move transcript visible-window slicing and right-gutter scrollbar overlay onto renderer-owned primitives, keeping the current TUI behavior while reducing app-local renderer logic.

Move the transcript viewport state machine onto the reusable renderer package while keeping the existing Super Kimi Code wrapper API intact.

Move the transcript viewport component implementation onto the reusable renderer package; the app wrapper now only supplies Super Kimi Code canvas painting and cache policy.

Move the shared TUI chrome gutter container implementation onto the reusable renderer package; the app wrapper now only supplies theme canvas painting and cache policy.

Move the tool-call composite child render cache onto the reusable renderer package, preserving output reuse while reducing app-local renderer bookkeeping.

Move assistant-message width-keyed render caching onto the reusable renderer package, preserving stable line-array reuse while reducing app-local renderer bookkeeping.

Move user-message width-keyed render caching onto the reusable renderer package, preserving stable line-array reuse while reducing app-local renderer bookkeeping.

Move thinking-message width-keyed render caching onto the reusable renderer package, preserving stable line-array reuse while reducing app-local renderer bookkeeping.

Move the `/btw` side-panel body onto renderer-owned stable scrollable frame rows, preserving tail-follow, manual scroll position, stable panel height, rounded frame rendering, and ANSI-safe title fitting while reducing app-local scroll and frame bookkeeping.

Route PlanBox and UsagePanel frame title fitting through the reusable renderer helper so command-triggered panels share the same ANSI-safe frame title policy.

Move the task-output and approval-preview full-screen viewer body frames and footer positioning onto renderer-owned scrollable frame-row primitives, preserving scroll controls while removing duplicated app-local width fitting and footer alignment.
