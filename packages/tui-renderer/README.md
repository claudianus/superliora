# @harness-kit/tui-renderer

Reusable native terminal renderer core for high-performance TUI applications.

This package is intentionally independent from any host app. It owns
terminal-renderer primitives that can later be moved to a standalone repository
without carrying application state, agent logic, or compatibility adapter code.

## Current Surface

- Styled cell buffers with bounding damage, dirty row-span tracking, and double
  buffering.
- Grapheme-aware display-width measurement, truncation, wrapping, and text-to-cell
  conversion for CJK, emoji, and combining-character output.
- Renderer-owned Text component primitive with ANSI-aware width measurement,
  word wrapping, grapheme-safe long-token wrapping, padding, optional background
  fill, and render-output caching for host TUI component migration.
- Compatibility text utilities named `visibleWidth`, `truncateToWidth`, and
  `wrapTextWithAnsi`, backed by the renderer's ANSI parser and grapheme-aware
  terminal width model.
- Renderer-owned `Container`, `Spacer`, and `Box` component primitives for
  vertical composition, blank row reservation, padded panels, optional
  background fill, and cached child-output reuse.
- Renderer-owned framed row projection for ANSI-safe bordered panels with
  square or rounded borders, optional bottom borders, inset or flush titles,
  symmetric or asymmetric internal padding, exact terminal-cell dimensions,
  injected border/title styling, and width-safe content truncation for
  task-browser panels, full-screen viewer bodies, transcript message cards,
  open-bottom side panels, welcome/login chrome, selector input boxes, and
  compact input/edit dialogs.
- Renderer-owned divider row projection with solid, heavy, double, dashed,
  ASCII, and thick line styles for exact-width, ANSI-styled horizontal rules
  used by selector headers/footers, queue/help/question/approval chrome, todo
  board column rules, static animated-divider fallbacks, and composite agent
  progress headers. The renderer's own overlay panels, diagnostics panels,
  Markdown horizontal rules, and editor side-border labels use the same
  primitive internally.
- Renderer-owned labeled divider row projection for exact-width section
  headers with styled leading/trailing rules, ANSI-safe label truncation, and
  configurable gaps; agent-swarm progress headers now use this instead of
  app-local rule fitting.
- Renderer-owned segmented progress bar projection for exact-width multi-phase
  status bars with stable largest-remainder width allocation, ANSI-safe styling,
  and empty-state rendering; agent-swarm total status bars now use this instead
  of app-local segment math.
- Renderer-owned ratio progress bar projection for compact fixed-width meters
  with clamped ratio, rounded filled-cell counts, configurable glyphs, and
  ANSI-safe filled/empty styling; `/usage` and `/status` meters now use this
  instead of app-local glyph repeat helpers.
- Renderer-owned stepped progress bar projection for exact-width braille or
  custom-level progress meters with cycle/separator metadata and per-cell
  styling; agent-swarm per-subagent bars now use this instead of app-local
  glyph accumulation loops.
- Renderer-owned cell VFX primitives for immutable pulse, shimmer, and reveal
  effects over `RendererCell` arrays, preserving wide-character continuation
  cells, plus clipped frame-buffer rect application with tracked damage so
  premium animated highlights can be shared across panels, lists, meters, and
  transcript rows without broad invalidation.
- Renderer-owned flat panel chrome projection for exact-width selector/dialog,
  approval, manager, and permission-prompt rows: top divider, styled
  title/suffix, styled hint, body rows, footer rows, configurable body/footer
  gaps, and bottom divider assembled through one reusable product API.
- Renderer-owned scrollable flat panel chrome projection that combines the
  shared panel chrome contract with clamped line-window projection, fixed
  headers, optional scroll footers, and returned viewport metadata for help,
  settings, and log-style panels.
- Renderer-owned focus and cursor-marker contracts with `Focusable`,
  `isFocusable`, and the zero-width `CURSOR_MARKER` used to project IME-aware
  hardware cursor positions from component output.
- Renderer-owned cursor-marker projection helpers that remove legacy inverse
  cursor cells, produce terminal cursor state, and clip marker cursors to a
  viewport for compatibility component output.
- Renderer-owned Markdown component and theme contracts for headings, links,
  inline emphasis, lists, quotes, tables, fenced code blocks, syntax-highlight
  callbacks, default text styling, padding, wrapping, and cached render output.
- Dirty-cell diffing that can scan dirty row spans instead of full bounding
  damage rectangles, reusable damage scan planning, plus horizontal render-run
  coalescing with plain short same-row gap bridging to reduce cursor-addressed
  output without introducing extra style/link transitions.
- ANSI terminal output encoding with adaptive truecolor, 256-color, 16-color,
  and no-color SGR modes plus synchronized update mode and absolute/relative/auto
  cursor-motion planning across CUP, CUF, CUB, CUU, CUD, and CHA sequences with
  byte-savings metrics for renderer diagnostics and traces.
- Renderer-owned inline image protocol helpers for Kitty graphics and iTerm2 /
  WezTerm image escapes, with conservative terminal capability detection.
- Frame output policies for compat, balanced, and premium synchronized-output
  behavior, including cursor-only, small-patch, output-run/output-cell pressure,
  and trailing row-erase fast paths.
- OSC 8 terminal hyperlink metadata parsing, diffing, caching, and output
  encoding for clickable terminal text.
- Renderer-owned cursor state with position, visibility, and DECSCUSR
  block/underline/bar shape encoding, including cursor-only frame output and
  managed-cursor placement through the same cursor-motion planner.
- Native frame presentation against an injected output target.
- Layout-frame rendering that can compose regions and present renderer-owned
  cursor state in the same frame.
- Constraint-based responsive layout primitives for splitting terminal rects
  with fixed, min, max, percentage, ratio, flex, gap, margin, and nested trees.
- Stack layout measurement for transcript/main regions plus fixed chrome rows,
  returning reusable row counts, y offsets, render rects, and frame-region plans.
- Region composition with clipping, z-order, viewport scrolling, and overlays.
- Region-level VFX composition for pulse, shimmer, and reveal effects over
  whole regions or region-local rects, with retained-row cache keys including
  effect timing so animated rows redraw without invalidating stable regions.
- Region VFX animation-frame policy for `auto`, forced, and disabled modes, so
  cosmetic effects can degrade to static rendering on inline terminals without
  synchronized-output support while fullscreen or explicitly opted-in hosts keep
  premium animation.
- Adaptive region VFX presets for focus pulse, loading shimmer, and content
  reveal effects, resolving against renderer quality, frame health, and reduced
  motion preferences so premium animation degrades gracefully under pressure.
- Fixed-width overlay panel region primitives with placement, clipping-safe
  geometry, truncation, height limiting, per-line styles, and compositor-ready
  output.
- Human-readable cell-buffer snapshots and diffs for deterministic terminal
  visual regression tests, including style and hyperlink runs.
- Parsed line-cell caching for repeated ANSI/styled rows, bounded by entry and
  parsed-cell budgets, so unchanged transcript and chrome lines can skip
  style-run segmentation across frames without unbounded memory growth.
- Retained composition row caching for opaque regions, so unchanged rows can
  skip cell writes before the final frame diff, with per-frame reuse metrics.
- Follow-output viewport state and a reusable transcript viewport controller,
  including page/home/end and wheel action mapping without forcing users back
  to the newest row while they are reading scrollback, plus manual
  scroll-intent preservation before content has overflowed.
- Bottom-anchored viewport line-window projection and right-gutter overlay
  rendering for transcript panes that need stable visible rows and scrollbars.
- A reusable transcript viewport component that composes child components,
  viewport state, line-window projection, gutter padding, scrollbar rendering,
  and host-provided canvas painting/cache policy.
- Reusable gutter container chrome for stable left/right terminal padding,
  host-provided canvas painting, and render-cache policy.
- Reusable children render-cache primitive for composite components that flatten
  stable child render outputs without duplicating cache bookkeeping in hosts.
- Reusable width-keyed render-cache primitive for components, including
  prefixed wrapped transcript lines, that rebuild output only when their width
  or caller-owned dirty state changes.
- Compact viewport history-status projection so host UIs can show consistent
  "reading history" affordances without app-local scroll math.
- Reusable scrollbar metrics and vertical glyph rendering from content length,
  viewport length, and offset.
- ANSI SGR text parsing, text utility helpers, component primitives, and
  focus/cursor marker contracts for compatibility with existing styled
  component output.
- Semantic renderer themes with dark/light defaults, palette tokens, style
  tokens, custom style extension, resolved cell styles, WCAG-style contrast
  ratio helpers, and theme audit checks for text and terminal chrome.
- Terminal session lifecycle for alternate screen, raw mode, bracketed paste,
  focus reporting, input forwarding, and resize forwarding.
- Adaptive terminal feature profiles that keep advanced keyboard, mouse,
  paste, focus, color, inline images, and synchronized-output modes behind
  environment capability checks, including conservative synchronized-output
  handling for known xterm.js hosts with renderer-level override environment
  variables.
- DECRQM / DECRPM terminal mode report parsing helpers for query-based
  synchronized-output detection, including the `CSI ? 2026 $ p` request string
  and conservative support resolution for unsupported or ambiguous responses.
- Async terminal capability probing for synchronized output that writes DECRQM,
  listens for DECRPM, times out safely, and caches/coalesces repeated checks for
  host adapters that need runtime capability confirmation.
- Native terminal renderer startup probing that can disable synchronized output
  and region VFX frame scheduling when the live terminal reports unsupported or
  does not answer, with terminal mode reports decoded as structured input events
  instead of legacy app keystrokes.
- Renderer diagnostics and trace markers include synchronized-output probe
  support, timeout, and enabled/disabled decisions so host apps can explain
  why sync output or dependent VFX scheduling changed at runtime.
- Output-stream backpressure from terminal writes is captured in frame results,
  renderer metrics, diagnostics, and trace exports; native renderers can defer
  render and animation frames until the terminal output target emits `drain`,
  then lower adaptive quality so VFX and animation pressure recover conservatively.
  Sustained output-byte or changed-cell pressure also lowers adaptive quality
  before the terminal stream reaches hard backpressure, with quality transitions
  exposed through renderer callbacks and trace markers, plus follow-up `quality`
  render frames that apply the new visual policy immediately.
- Host-controlled auto-frame hold for scrollback or transcript inspection modes:
  native renderers can pause ordinary `request`, `animation`, and `quality`
  frames while still allowing `start`, `resize`, and explicit `manual` frames,
  then release coalesced work with trace markers for diagnostics.
- Structured terminal input decoding for printable keys, navigation keys, focus
  events, bracketed paste, and CSI-u/Kitty-style modified key sequences.
- Legacy input-sequence encoding so native structured events can be bridged into
  existing app key routing during migration.
- Renderer-owned key identifier helpers, Kitty printable decoding, release /
  repeat detection, and fuzzy filtering contracts for dialog/editor migration
  without inheriting host-app input utilities.
- Renderer-owned SelectList runtime and theme/layout contracts for autocomplete
  and picker migration, with width-aware primary/description columns and
  renderer-owned key handling.
- Renderer-owned combined autocomplete provider for slash commands, command
  argument completion, regular path completion, `@` file mentions, optional
  fd-backed fuzzy file search, and Node filesystem fallback behavior.
- Renderer-owned editor autocomplete controller for provider request/abort
  lifecycles, selection movement, completion projection, and width-bounded
  overlay line rendering without host-app editor state dependencies.
- Renderer-owned input routing with focused targets, modal capture, global
  fallback handlers, focus stack restoration, and ordered focus navigation.
- Renderer-native text input primitive with Unicode-aware editing, multiline
  paste, caller-owned atomic ranges for indivisible spans, soft-wrap rendering,
  visual-row cursor navigation, keyboard selection with caller-owned selection
  styling, click-to-place and drag-selection mouse handling, word/line editing
  shortcuts, page navigation, document-boundary Home/End shortcuts,
  history-backed undo/redo, placeholder styling, and real cursor-state output.
- Host-agnostic editor text-input bridge that syncs renderer-native text input
  state with caller-owned editor models, routes mouse/cursor/text mutation
  events through caller-provided content geometry, and keeps app-specific prompt
  policies outside the renderer core.
- Reusable command-prefix editor input policy for prompt/shell-style modes,
  including prefix entry, empty command-mode exit, paste prefix stripping, and
  caller-owned interaction hooks.
- Renderer-owned editor chrome helpers for ANSI-safe slash-command token
  highlighting, prompt symbol injection, argument-hint ghost text, and bordered
  legacy-editor row wrapping with caller-provided paint functions, plus
  cell/string native argument-hint projection and cell-based native editor frame
  rendering for prompts, borders, scrollbars, local cursor projection, complete
  editor surface composition with overlay row allocation, surface cursor
  placement/clipping, and native text-input scrollbar derivation, plus shared
  frame content geometry for mouse hit-testing and text input layout, and
  semantic editor surface style resolution for host themes.
- Renderer-owned root UI and terminal host contracts for app adapters, so
  terminal rows/columns/write/title/progress/input-listener/request-render
  capabilities can be typed without depending on a specific TUI runtime.
- Native root UI harness for portable apps: owns children, focus, terminal
  input listeners, cursor-marker projection, and a `NativeTerminalRenderer`
  backend without requiring a third-party TUI runtime.
- Opt-in Kitty keyboard protocol lifecycle with reversible push/pop cleanup.
- On-demand render loop with request coalescing, target-FPS frame pacing, and
  browser-style one-shot animation frame callbacks.
- Reusable interval ticker for host-driven animation invalidation, with
  caller-owned FPS limits, minimum interval pacing, gating hooks, and injectable
  timers, plus caller-resolved intervals for adaptive animation pacing.
- Timeline/easing helpers, timeline playback on renderer animation clocks, and
  style/color interpolation primitives for renderer-owned animation and
  terminal VFX.
- Motion presets and scalar transitions that resolve duration/easing against
  reduced-motion preferences, adaptive quality, and renderer frame health.
- Reusable effect policy helpers that resolve requested VFX levels against
  adaptive quality state, rolling frame-budget health, and reduced-motion
  preferences, including effect-aware animation frame intervals.
- Renderer-owned text effect projection helpers for stable seeded animation
  phases, positive modulo, deterministic seed hashing, and grapheme-aware
  styled text runs, width measurement, width-aware wrapping, ellipsis
  truncation, cells, ANSI output, and gradient text projections that host apps
  can paint with their own theme system or feed directly into renderer-native
  buffers.
- Transcript line composition helpers for ANSI-aware prefix width measurement,
  prefix/continuation layout, final line truncation, escape-preserving lines,
  first/tail preview windows for collapsed tool output, and a reusable generic
  head/tail line-window projection for transcript, command, running shell,
  diff-preview, and non-empty log/tool excerpt rows plus a prefix-wrapped line
  component for hanging-indent transcript rows, plus wrap-aware capped text
  preview with ellipsis projection for compact status panels.
- Reusable scrollable line viewport state and line-window projection for
  panel/log bodies, including tail-follow, line/page/home/end scroll actions,
  scroll-top clamping, overflow reporting, visible line-range and percentage
  metadata, stable row padding and stable-height panel bodies, full-screen
  output/approval preview bodies, task-browser preview tails, and renderer
  scrollbar affordances.
- Stable scrollable frame-row composition for panel bodies that need shared
  viewport state, exact bordered row dimensions, title fitting, and title-width
  context for overflow-aware panel chrome.
- Scrollable frame-row viewer composition for full-screen preview/output
  surfaces, including shared viewport projection, exact-width line fitting,
  scroll position formatting, and aligned footer rows.
- Reusable selectable-list viewport state and projection for task browsers,
  pickers, and menus, including selected-index clamping, selection movement,
  scroll padding, selected-row visibility, overflow reporting, visible
  line-range metadata, projected row indices/selection flags, and integration
  with renderer-owned scrollbar metrics/glyph rendering.
- A reusable truncated-output component that owns wrap-aware output preview,
  tail/head line capping, truncation hints, indentation, and trailing-empty-line
  cleanup while allowing host apps to inject theme formatting.
- Tool activity projection helpers for reusable running/succeeded/failed/
  truncated phase resolution, header grammar, and chip separator formatting.
- Live native renderer runtime that ties terminal session lifecycle, resize,
  frame rendering, parsed-line and retained-row caches, render-loop scheduling,
  adaptive quality state, and row/cell scan metrics into one backend object,
  including rolling FPS/cadence, tail frame-time, render/present/write phase
  timing, dominant phase bottleneck classification, frame-budget, frame-history,
  output-run/bridged-cell optimization metrics, cursor-motion byte-savings
  metrics, and scan-strategy/cache-efficiency summaries for diagnostics and
  adaptive feature policy.
- Renderer diagnostics snapshots that normalize frame health, adaptive quality,
  output volume, output-run optimization, composition-cache reuse, and line-cache
  hit rate into a compact severity plus issue list for host apps and debug
  panels, exposed directly from the native renderer runtime with compact and
  structured text formatters, fixed-width panel formatters, plus compositor-ready
  diagnostics overlay regions.
- Bounded renderer trace recording for frame, resize, marker, and sanitized input
  events, including frame output-policy decisions, output-run optimization
  counters, and cursor-motion byte counters, with Chrome JSON export for
  DevTools/Perfetto-style offline analysis.

## Minimal Example

```ts
import {
  NativeInputRouter,
  NativeTerminalRenderer,
  rendererDarkTheme,
  rendererThemeStyle,
} from '@harness-kit/tui-renderer';

let renderer: NativeTerminalRenderer;
const inputRouter = new NativeInputRouter();

inputRouter.registerGlobalHandler({
  id: 'quit',
  onInput: (event) => {
    if (event.type !== 'key' || event.key !== 'escape') return false;
    renderer.stop();
    return true;
  },
});

renderer = new NativeTerminalRenderer({
  input: process.stdin,
  output: process.stdout,
  screenMode: 'alternate',
  keyboardProtocol: 'kitty',
  rawMode: true,
  hideCursor: true,
  bracketedPaste: true,
  focusEvents: true,
  synchronized: true,
  targetFps: 60,
  inputRouter,
  render: ({ renderer: frame }) => {
    frame.writeText(0, 0, 'hello', rendererThemeStyle(rendererDarkTheme, 'accent'));
  },
});

renderer.start();
renderer.requestRender('start');
```

## Design Direction

The package should stay small and renderer-focused. Application-specific UI
state, agent messages, permission dialogs, model/provider code, and legacy
compatibility adapters belong in consuming apps.
