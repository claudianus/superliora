---
"@harness-kit/tui-renderer": patch
"@moonshot-ai/kimi-code": patch
---

Add reusable native TUI renderer primitives and route the CLI native editor frame, cursor-marker projection, surface layout, cursor projection, style resolution, input geometry, argument hints, seeded text-effect projection, immutable cell VFX projection for pulse, shimmer, and reveal effects with clipped frame-buffer rect application, tracked damage, region-level composition/cache keys, adaptive focus/loading/reveal presets, reusable VFX animation-frame predicates, a reusable animation-frame request gate and region VFX scheduler, native renderer runtime region-VFX frame scheduling methods, runtime layout-frame presentation with cache-backed composition and automatic VFX frame scheduling, CLI native editor/diagnostics region VFX wiring with self-scheduled native animation frames, styled text measurement, wrapping, output, transcript line composition, head/tail line-window projection for thinking, command, running shell, diff, and non-empty tool excerpts, scrollable panel and full-screen viewer line-window projection with stateful viewport actions, manual pre-overflow scroll-intent preservation, and visible range/percent metadata, task-browser preview tail projection, selectable-list viewport projection with renderer scrollbar affordances, task-browser, full-screen viewer, transcript message-card, open-bottom side-panel, welcome/login chrome, selector input-box, compact input/edit-dialog framed panel row projection with flush-title, rounded-border, optional-bottom-border, asymmetric-padding, and padding options, named-line-style selector/chrome/appearance/internal divider row projection, labeled divider row projection for agent-swarm progress headers, ratio progress projection for usage/status meters, segmented progress bar projection for agent-swarm total status bars, stepped braille progress projection for per-subagent bars, flat selector/plugin/approval/manager/permission panel chrome projection with configurable body/footer gaps, scrollable flat panel chrome projection with fixed headers and range footers, wrap-aware capped text preview, prefix-wrapped transcript rows, collapsed-output preview projection, truncated-output rendering, tool activity header projection, short-gap render-run output optimization with frame stats, diagnostics, trace counters, synchronized-output policy thresholds, auto cursor-motion encoding for render runs and managed cursor placement across absolute, relative, vertical, and horizontal-absolute ANSI moves with byte-savings diagnostics and trace metrics, editor contract, autocomplete, publishable dist-based package exports, and native renderer experiment editor backend through that renderer boundary.

Expose the native renderer runtime on render callback frames so render callbacks can present layout frames and schedule region VFX without capturing the renderer instance.

Keep adaptive synchronized-output detection conservative for Wave/xterm.js hosts and allow standalone renderer consumers to override the decision with `HARNESS_TUI_SYNCHRONIZED_OUTPUT` or `TUI_RENDERER_SYNCHRONIZED_OUTPUT`.

Gate cosmetic region VFX animation frames behind a native renderer `regionVfxFrames` policy so inline hosts without synchronized-output support degrade animated regions to static rendering by default, while fullscreen or explicitly opted-in hosts keep self-scheduled premium effects.

Suppress Super Kimi Code native-region VFX while the transcript viewport is manually scrolled away from live output, keeping focus and diagnostics effects from waking the renderer while the user is reading scrollback.

Add public DECRQM / DECRPM helpers for query-based synchronized-output capability detection, including the `CSI ? 2026 $ p` request sequence, DEC mode report parsing, and conservative support resolution for native renderer hosts.

Add an async synchronized-output capability probe that writes the DECRQM request, listens for the matching DECRPM response, safely times out to an unknown result, and provides a cache/coalescing wrapper for host adapters.

Wire synchronized-output probing into the native renderer startup path so live terminals can disable synchronized output and dependent VFX scheduling when runtime support is missing.

Expose synchronized-output probe support and timeout decisions in renderer diagnostics and trace markers so native renderer hosts can explain runtime fallback behavior.

Track terminal output backpressure from frame writes in renderer metrics, diagnostics, trace exports, and adaptive quality decisions, defer native render/animation frames until `drain` when the terminal output stream is backpressured, lower adaptive quality after sustained output-byte or changed-cell pressure before hard stream backpressure occurs, and expose quality transitions through `onQualityChange`, trace markers, and follow-up `quality` render frames that apply the new visual policy immediately.

Add host-controlled auto-frame hold for scrollback inspection: native renderers can pause ordinary request, animation, and quality frames while still allowing start, resize, and explicit manual frames, then release coalesced work once the host returns to follow-output mode.

Add renderer-owned viewport history-status projection so host apps can present consistent paused-follow indicators without duplicating scroll-distance formatting.

Add renderer-owned bottom-anchored viewport line-window projection and right-gutter overlay rendering for reusable transcript panes with stable visible rows and scrollbar affordances.

Add a reusable renderer-owned transcript viewport controller for follow-output state, page/line/top/bottom scrolling, manual scrollback intent, and visible-row preservation across content and viewport-height changes.

Add a reusable transcript viewport component that composes child rendering, gutter padding, viewport projection, scrollbar painting, and host-supplied canvas/cache policy behind the renderer package boundary.

Add a reusable gutter container primitive for stable left/right terminal padding with host-supplied canvas painting and render-cache policy.

Add a reusable children render-cache primitive for composite components that flatten stable child render outputs without duplicating cache bookkeeping in host apps.

Add a reusable width-keyed render-cache primitive for line components that rebuild output only when width or caller-owned dirty state changes, and use it for prefixed wrapped transcript lines.

Add a stable scrollable line viewport primitive for panel bodies that should preserve their grown height while still respecting a current maximum viewport cap.

Add a stable scrollable frame-row primitive that combines stable panel body projection with exact bordered frame rendering, renderer-owned title-width context, and ANSI-safe title fitting.

Add reusable scrollable frame-row viewer primitives for full-screen preview/output surfaces, including exact-width line fitting, scroll position formatting, and aligned footer row composition.
