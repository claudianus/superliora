# TUI renderer independence plan

This note captures the current `pi-tui` dependency surface and the target path
for replacing it with a product-owned renderer. It is intentionally scoped to
the TUI renderer boundary; product naming, provider independence, and packaging
renames should proceed on separate tracks.

## Initial dependency surface

Before Phase 1, the TUI was not loosely coupled to `@earendil-works/pi-tui`.

- `createTUIState()` constructs the real `ProcessTerminal` and `TUI` directly.
- `LioraTUI` treats the root `TUI` as both the render tree and input/focus host.
- 84 source files under `apps/liora/src/tui` and `apps/liora/src/migration`
  imported `@earendil-works/pi-tui` directly.
- 64 of those imports live under `src/tui/components`, so the component tree is
  the largest migration surface.
- The most common imports are `Component`, `Text`, `truncateToWidth`,
  `visibleWidth`, `Container`, and `Spacer`.

The practical implication is that replacing `TUI` alone is not enough. The
component contract, text measurement helpers, focus handling, and terminal
input/output lifecycle must all get a local boundary before the renderer can be
swapped safely.

## Why the current renderer is not enough

The existing renderer is useful for fast product work, but it is the wrong long
term owner for premium chat-style terminal UX.

- It renders into the main terminal buffer and relies on terminal scrollback for
  old content.
- It has no first-class transcript viewport model owned by the app.
- It assumes output following in normal render paths, so user scroll intent is
  hard to preserve during streaming.
- Routine changes above the visible viewport can force full redraw behavior in
  the underlying renderer.
- Animation and volatile rows are app-managed workarounds rather than renderer
  primitives.
- Fixed footer/input behavior is an emergent property of render ordering, not a
  renderer guarantee.

External renderers point to the same direction: OpenTUI exposes screen modes,
Ratatui uses double-buffered diff rendering, Ink treats alternate screen as an
explicit mode, and Blessed-style renderers rely on damage buffers and cursor
movement rather than rewriting history.

References:

- OpenTUI renderer screen modes: https://opentui.com/docs/core-concepts/renderer/
- Ratatui rendering internals: https://ratatui.rs/concepts/rendering/under-the-hood/
- Ratatui alternate screen: https://ratatui.rs/concepts/backends/alternate-screen/
- Ink alternate screen behavior: https://github.com/vadimdemedes/ink
- Blessed renderer model: https://piranna.github.io/blessed/

## Target renderer contract

The product-owned renderer should provide these primitives directly:

- **Terminal I/O**: raw mode, resize, focus reporting, keyboard protocol setup,
  structured key decoding, paste handling, progress/title OSC handling, shutdown
  cleanup.
- **Screen mode**: `main`, `alternate`, and eventually `hybrid`, with explicit
  lifecycle and no routine scrollback clearing.
- **Cell buffer**: styled cells, hyperlink metadata, image placeholders, and a
  previous/current damage diff.
- **Layout regions**: transcript, live activity, panels, editor, footer, and
  overlays are distinct regions with stable dimensions.
- **Viewport model**: transcript has `scrollOffset`, `followOutput`, and a
  visible window independent of terminal scrollback.
- **Scroll affordances**: scrollable regions expose reusable scrollbar metrics,
  visible line ranges, and scroll percentage indicators, instead of relying on
  terminal scrollback.
- **Volatile regions**: spinners, timers, and animation rows are skipped when
  offscreen and coalesced when visible.
- **Input/focus model**: focus stack, modal capture, global key routing, and IME
  cursor positioning are renderer-owned APIs.
- **Measurement**: local `visibleWidth`, truncation, wrapping, and ANSI/OSC
  handling so components do not import renderer internals.

The public local API should be small. Application code should not know whether
the backend is the current `pi-tui` adapter, an OpenTUI spike, or the native
renderer.

## Migration path

### Phase 1: Local facade, no behavior change

Create `src/tui/renderer/` with local exports for the APIs we actually use:

- `Component`
- `Focusable`
- `Container`
- `Text`
- `Markdown`
- `Spacer`
- `Terminal`
- `TUIRoot`
- `visibleWidth`
- `truncateToWidth`
- `wrapTextWithAnsi`
- key helpers

The first implementation simply re-exports `@earendil-works/pi-tui`. Then move
imports module-by-module from `@earendil-works/pi-tui` to `#/tui/renderer`.
This is mechanical and testable, and it gives us one switch point.

Acceptance:

- No behavioral diff.
- No direct `@earendil-works/pi-tui` imports outside `src/tui/renderer/` and
  narrowly accepted migration/bootstrap files.
- Existing TUI tests pass.

Status: implemented. Production and TUI test imports now go through
`#/tui/renderer`; `src/tui/renderer/index.ts` is the only production direct
import, and a guard test enforces the boundary.

### Phase 2: Renderer factory and owned terminal lifecycle

Move `new ProcessTerminal()` and `new TUI()` behind a renderer factory.
`createTUIState()` should receive a renderer bundle instead of constructing the
backend itself.

Acceptance:

- TUI startup/shutdown paths use product-owned lifecycle methods.
- `LioraTUI` no longer calls backend-specific root APIs directly except through
  the facade.
- Test helpers can supply a fake renderer without importing `pi-tui`.

Status: implemented for creation and lifecycle. `createTUIState()` now receives
or creates a `TerminalRenderer` bundle, and `LioraTUI` startup/shutdown uses the
bundle's `start()`, `stop()`, and `drainInput()` methods. Wider render invalidation
and terminal feature calls still intentionally use the compatibility fields until
the transcript viewport work defines the next API.

### Phase 3: Transcript viewport in front of the existing backend

Introduce a transcript viewport component before replacing the full renderer.
It should compute the visible transcript window and expose scroll operations.

Acceptance:

- When the user scrolls up, `followOutput` becomes false.
- New streaming output does not pull the viewport to the bottom until the user
  explicitly returns to bottom.
- Footer and editor remain visible while transcript scrolls.
- Animation ticks cannot mutate offscreen transcript rows.

Status: in progress. The TUI now owns a thin `TranscriptViewportState` adapter
backed by the reusable `RendererViewport` primitive from `@harness-kit/tui-renderer`.
It exposes `followOutput` and `offsetFromBottom`, and the transcript container
slices its rendered rows through that shared viewport when terminal height is known.
PageUp/PageDown/Home/End on an empty prompt move this viewport; ambient
animation keeps running while the transcript is scrolled back and is only
gated while a transcript selection is active. Full-screen output
and approval-preview viewers now use renderer-owned scroll state, line, page,
home, and end actions, visible line windows, and footer range/percentage state
instead of recalculating those scroll affordances in each component. The task
browser list now uses renderer-owned selectable-list viewport state to keep
selection and scroll offset together, so long task lists keep the selected row
visible without app-local `listScroll` math, and its overflow affordance is
drawn with renderer scrollbar metrics. The first renderer
region model is now in the local facade: transcript height is measured as the
terminal rows left after the current activity, todo, queue, BTW, editor, and
footer regions render. Mouse-wheel input in the native path is routed through
the shared renderer input-to-viewport action mapper. The transcript viewport now
renders a right-gutter scrollbar from reusable renderer scrollbar metrics when
content overflows, so users can see whether they are reading history or pinned
near the newest output. The renderer viewport also preserves manual scrollback
intent before content has overflowed, so a user who scrolls up during early
streaming is not snapped back to the tail once later output pushes the transcript
past the visible region. The native renderer adapter now also holds ordinary
request, animation, and quality frames while the transcript viewport is not
following output, while explicit manual scroll renders still pass through; this
keeps streaming or cosmetic ticks from pulling the terminal back to the bottom
while the user is reading history. The local `TerminalRenderer` facade now
applies the same automatic-frame hold to the pi-tui compatibility backend, so
the current default path and the native path share the same follow-output
contract during migration. The footer now shows a compact history-distance badge
from renderer-owned history status projection while follow-output is paused,
making the lock state visible without adding another panel. The transcript
viewport component now delegates child rendering, gutter padding,
bottom-anchored visible-window projection, and right-gutter scrollbar overlay
rendering to the renderer package. Its follow-output state machine is now the
renderer-owned `RendererTranscriptViewport`, with the app wrapper kept only to
supply SuperLiora canvas painting/cache policy and preserve existing call
sites. The shared chrome gutter container has followed the same pattern: stable
left/right padding and cached child composition live in the renderer package,
while the app wrapper only supplies theme canvas painting/cache policy. Tool
call transcript cards now use the same renderer-owned child render-cache
primitive for composite output flattening, and assistant/user/thinking message
cards use a renderer-owned width-keyed render cache for stable line-array reuse.
The remaining work is to style these surfaces through renderer theme tokens once
the native backend owns the component tree.

This phase delivers the main user-visible value before the risky renderer swap.

### Phase 4: Native cell-buffer backend

Implement the first product-owned backend behind the same facade:

- fixed-size frame buffer
- region layout
- dirty-cell diff
- cursor positioning
- synchronized output where supported
- resize recovery
- main/alternate screen modes

Status: started at the reusable package boundary. `packages/tui-renderer`
owns the native renderer core independently from the SuperLiora app, and the app
facade re-exports it through `#/tui/renderer` while the `pi-tui` compatibility
adapter remains local to the app. The package contains frame-buffer primitives:
styled cells with OSC 8 hyperlink metadata, bounding damage rectangles, per-row
dirty spans, double buffering, changed-cell diffs that can skip clean rows
inside a large damage bound, and coalesced horizontal render runs. It now owns
grapheme-aware display-width
measurement, truncation, wrapping, and text-to-cell conversion, so Korean/CJK,
emoji, ZWJ clusters, and combining-character output can align to the terminal
grid before diffing. Its terminal output encoder turns those diffs into
cursor-addressed ANSI output with truecolor SGR styling, control-character
sanitization, wide-cell continuation handling, and optional `CSI ? 2026`
synchronized output wrapping. The output layer also owns cursor state: frames
can now emit cursor-only updates with explicit position, visibility, and
DECSCUSR block/underline/bar shape control, which is the primitive needed for a
renderer-native editor cursor instead of inverse-video text markers. Its
present-capable native frame backend manages the double buffer, writes encoded
frame output to an injected target, suppresses no-op presents, and forces full
redraws after startup or resize. It also tracks cursor-only frame changes
separately from cell damage, so moving the editor cursor does not require
rewriting content cells. Its layout engine adds constraint-based
responsive rect splitting with fixed, min, max, percentage, ratio, flex, gap,
margin, and nested layout-tree primitives, so app adapters can move away from
hard-coded terminal row math. It also owns primary/fixed stack layout
measurement and frame-region planning, returning row counts, y offsets, rects,
and native frame regions for transcript-plus-chrome layouts. Its compositor
adds rect clipping, viewport scrolling, stable z-order, overlay clearing, and
per-cell style preservation, and can reuse a bounded parsed line-cell cache so
unchanged ANSI/styled rows avoid repeated style-run segmentation across frames.
It also owns a retained composition row cache for opaque regions: when the
layout topology is stable, unchanged transcript/chrome rows can skip cell writes
before the final frame diff while changed rows still clear their own stale
tails.
Its renderer-native text input now covers the editor replacement path:
Unicode-aware editing, multiline paste, placeholder rendering, soft wrapping,
visual-row cursor navigation, keyboard selection with caller-owned selection
styling, click-to-place and drag-selection mouse handling, word/line editing
shortcuts, page navigation, document-boundary Home/End shortcuts,
history-backed undo/redo, real terminal cursor output, and caller-owned atomic ranges so mentions,
placeholders, paste markers, and other app-defined spans can move and delete as
indivisible units.
Its ANSI parser converts SGR-styled strings into styled cells, including reset,
bold/dim/italic, underline, inverse, basic 16-color, 256-color, and truecolor
sequences, and it now preserves OSC 8 hyperlinks as cell metadata that the diff,
line cache, and terminal output encoder can round-trip. This is the compatibility
bridge for existing chalk/pi-tui component output while the native backend takes
ownership. Its layout-frame adapter lets
anything with `render(width)` resolve into renderer regions, compose into a
native frame, and present through the owned diff/output backend. The package
also owns the native terminal session lifecycle: alternate-screen entry/exit,
cursor visibility, bracketed paste, focus reporting, raw-mode restoration,
input forwarding, resize forwarding, and adaptive feature profiles that degrade
advanced protocol opt-ins from environment capabilities. Its render loop
coalesces repeated render requests, paces frames to a target FPS, and
provides one-shot animation frame callbacks so animation/VFX scheduling is a
renderer primitive rather than scattered app timers. The package now also owns
semantic renderer themes with dark/light defaults, palette tokens, style tokens,
custom style extension, and resolved cell styles, plus timeline/easing helpers,
style/color interpolation primitives, seeded text-effect phase projection, and
grapheme-aware styled text measurement, wrapping, truncation, run/cell/ANSI
output for renderer-owned VFX. It also owns reusable transcript line
composition and preview-window helpers, so assistant/user/tool-output rows now
share ANSI-aware prefix measurement, continuation alignment, final truncation,
collapsed-output slicing policy, reusable head/tail line-window projection, and
prefix-wrapped hanging-indent rows through the renderer boundary. Tool-output
preview now uses a renderer-owned truncated output component for wrap-aware line capping, tail/head windows, hints,
indentation, and trailing-empty-line cleanup, with app theme colors injected as
formatters. Shell command preview, streaming Write previews, running shell
output tails, and diff preview truncation use the same generic head/tail
line-window projection so capped command/code/diff previews share one renderer
policy. Goal status text now uses renderer-owned wrap-aware capped text preview
instead of app-local wrap/slice/ellipsis logic. Single-subagent tool rows and
latest output/error excerpts now use renderer-owned generic and non-empty line
window projection instead of app-local split/filter/slice logic. The `/btw`
panel body now uses renderer-owned stable scrollable frame rows plus the same
projection for tail-follow, scroll-top clamping, overflow state, scroll actions,
content updates, stable row padding, rounded frame composition, and ANSI-safe
title fitting from renderer-provided title width. PlanBox and UsagePanel frame
titles also use the same renderer-owned title fitting helper; the
full-screen task-output and approval-preview viewers use renderer-owned
scrollable line viewport state, frame-row viewer projection, exact-width line
fitting, aligned footer rows, and the same projection for scroll actions,
content updates, blank-row fill, and footer position state. The task browser
preview output tail also uses
renderer-owned scrollable line projection and scrollbar glyphs instead of
app-local tail slicing. The task browser list now
uses renderer-owned selectable-list viewport projection for
selected-index clamping, visible-window slicing, and selected-row flags instead
of app-local `listScroll` adjustment, with the list scrollbar drawn from
renderer-owned scrollbar glyph projection. The task browser's framed panels and
full-screen task-output / approval-preview viewer bodies now use renderer-owned
bordered row projection for exact-width borders, titles, and content clipping
instead of locally assembling `┌─│└` rows. Compact API key, feedback, custom
endpoint, custom registry, and goal-edit dialogs also use the same
renderer-owned frame projection for rounded borders and internal padding.
Plan and usage transcript cards use the renderer-owned frame projection's
flush-title mode, so message-card borders, title fitting, and content padding no
longer duplicate app-local box drawing. The `/btw` side panel also uses the same
projection with an open-bottom rounded frame, preserving its editor-attached
layout while moving side-border and content padding math into the renderer.
Welcome and OAuth device-code chrome now share the renderer-owned frame
projection too, including asymmetric left padding for legacy chrome alignment
and exact-width rounded borders around particle rails and login instructions.
The plugins panel custom URL input box also uses the same renderer projection,
so selector-local input chrome no longer assembles rounded borders by hand.
Selector and manager header/footer rules now use renderer-owned divider row
projection instead of app-local `─`.repeat calls, keeping exact-width rule
rendering and style injection behind the renderer facade.
The divider primitive now also supports named line styles and backs help,
queue, structured question, todo-board, and static agent-swarm rules, so chrome
components compose reusable renderer rule segments instead of owning terminal
glyph repeat math. Agent-swarm progress headers additionally use renderer-owned
labeled divider projection, moving the label width, ANSI-safe truncation, and
trailing rule fitting out of the app component. Its total status bar now also
uses renderer-owned segmented progress projection, moving phase-count width
allocation, empty-state rendering, and exact-width ANSI styling out of the app.
Per-subagent braille bars now use renderer-owned stepped progress projection
and renderer-exported braille glyph levels, leaving phase semantics and theme
color choice local while moving tick-to-cell glyph accumulation into the
reusable renderer. `/usage` and `/status` compact ratio meters now use the
renderer-owned ratio progress projection, so clamping, rounded filled-cell
counts, glyph choice, and ANSI-safe exact-width output are shared with the
other progress primitives.
Static particle-divider fallbacks use the same renderer primitive, leaving the
app's appearance utilities to handle timing, seeded motion, and theme token
choice rather than rule construction.
Inside the renderer package, overlay panels, diagnostics panels, Markdown
horizontal rules, and editor side-border label fill now use the same divider
primitive too, so the product API and internal implementation share one
exact-width rule path.
Undo, experiment, model, goal-queue, session, structured-question, approval,
plugins, plugin MCP selector, provider manager, and start-permission prompt
chrome now use renderer-owned flat panel chrome projection, moving the top
divider, title, hint, body, footer, gap, and bottom divider contract behind one
reusable boundary while leaving item semantics local to the app.
The `/help` panel now uses renderer-owned scrollable panel chrome projection,
so its header, divider chrome, clamped body window, scroll range footer, and
viewport metadata come from the reusable renderer boundary instead of local
line slicing.
Generic tool activity phase projection, header grammar,
subtool row grammar, and chip separator formatting also cross that boundary,
while the app still supplies tool-specific semantics and theme colors. Its
input decoder now emits
structured key, focus, paste, and unknown-control events for printable text,
navigation keys, function keys, bracketed paste, focus in/out, modified CSI
functional keys, and CSI-u/Kitty-style key sequences while still allowing raw
input forwarding. The terminal session can now opt into Kitty keyboard
disambiguation with reversible push/pop cleanup, giving the native backend a
real keyboard protocol lifecycle instead of app-level parser workarounds. The
package also exposes a legacy-sequence encoder for structured input events, so
the app can route native input through the existing editor path while the
compatibility backend is being retired. Its input router now owns focused
targets, modal capture, global fallback handlers, focus stack restoration, and
ordered focus navigation, and `NativeTerminalRenderer` can dispatch decoded
events through that router. The input layer also decodes SGR mouse press,
release, motion, and wheel sequences and can opt terminal sessions into SGR
mouse tracking for a future visible native backend. Terminal feature profiles
(`minimal`, `inline-app`, `fullscreen-app`) now bundle reversible raw-mode,
paste, focus, mouse, Kitty-keyboard, cursor, synchronized-output, and alternate
screen behavior, with adaptive inline/fullscreen profiles for modern terminals,
multiplexers, and dumb terminals so apps do not spread terminal capability
decisions across callsites. Its live runtime now ties terminal session lifecycle, raw and
structured input forwarding, resize handling, frame-buffer rendering, frame
metrics, and the render loop together behind one `NativeTerminalRenderer`
object. Each rendered frame now reports duration, target frame budget, budget
overrun state, changed/scanned/total cells, and output bytes so performance work
can be driven by renderer evidence instead of visual guesswork. The runtime also
maintains rolling frame stats and exposes an `onFrame` hook so renderer quality
checks can subscribe without coupling to app render internals. The diff path now
also reports scanned and dirty row counts, so sparse transcript updates can be
measured separately from full-frame or full-rectangle redraw work. Parsed line
caching is now bounded by both entry count and parsed-cell count, and the native
runtime accepts those cache limits directly so long transcripts cannot grow the
renderer cache without a product-owned budget. The package now also has a
renderer-native `RendererTextInput` primitive with structured key/paste handling,
Unicode-aware cursor movement/deletion, soft wrapping, placeholder styling, and
real cursor-state output. The app can project the current editor text, cursor,
and paste-marker atomic ranges into that model, and the native input router can
let structured editor events be consumed before falling back to the legacy string
input path. When the native backend renders the mounted app editor, the editor
region now uses a TUI-state-owned renderer-native text input model for its
visible text, chrome, terminal cursor state, selection state, and undo/redo
history while preserving the existing editor container height and
replacement-modal fallback. Structured editor mouse input now also uses the same
model for click-to-place cursor movement and synchronizes the result back into
the current app editor, while wheel and non-editor mouse input continue to fall
through to the transcript/global handlers. Non-empty editor cursor-navigation
keys now follow the same renderer-native text model before syncing the cursor
back into the current app editor, including shift-selection and Ctrl+Home/End
document-boundary selection for native renderer highlighting. PageUp/PageDown
also route to the native editor when the current editor content can scroll
internally, while short prompts still fall through to transcript navigation.
Text mutation (printable characters, paste, Backspace/Delete, explicit newline
input, and native undo/redo) also flows through the renderer-native model while preserving
app callbacks such as change
notifications, bash-mode entry, newline hooks, and autocomplete reopen.
Submit, escape, tab, empty-prompt history/scroll navigation, and other app-level
shortcuts still fall back to the legacy editor path until those behaviors are
replaced deliberately. This gives the migration a product-owned replacement path
for the pi-tui editor core without forcing the full editor swap in the same step.
The editor frame chrome has also moved into `@harness-kit/tui-renderer`, so
prompt glyphs, borders, scrollbar cells, and local cursor projection are
renderer package behavior instead of app-local cell assembly. The app now
types its mounted editor through a `TUIEditor` contract and creates the current
`CustomEditor` through a factory, leaving the concrete pi-tui subclass isolated
to the compatibility implementation and its focused tests. A first
renderer-native `NativeTUIEditor` implementation now satisfies that same
contract without extending the legacy editor, including native text mutation,
cursor state, submit/history behavior, shell-command mode, shortcut routing,
editor-frame rendering, renderer-projected argument hints, and provider-backed
autocomplete through the renderer-owned editor autocomplete controller.
Native editor render now goes through a renderer-owned editor surface composer,
so frame height, prompt frame rendering, argument-hint projection, cursor
projection, surface cursor placement/clipping, autocomplete overlay row
allocation, and native text-input scrollbar derivation are package behavior
rather than app-local render ordering.
The editor-frame content geometry used for mouse hit-testing, cursor key layout,
text mutation layout, and native frame rendering is now exported by the renderer
package as one shared contract instead of duplicated in the app.
Editor surface color roles are also resolved through the renderer package:
the app maps its theme palette into semantic editor roles, while the renderer
owns border, prompt, text, placeholder, scrollbar, selection, and surface style
derivation.
`createTUIState()` can mount it through the editor backend option for
experimental wiring. Startup now switches to that
native editor backend when the `native_renderer` experiment is enabled, before
autocomplete, persisted history, focus, and visible native renderer attachment
are wired.
`src/tui/utils/native-layout-frame.ts` connects the package to the actual Kimi
TUI state, building transcript, activity, todo, queue, BTW, editor, and footer
regions from the current containers as opaque native frame bands for
native preview/smoke rendering. It also uses renderer-owned cursor-marker
projection to turn pi-tui focus cursor markers into terminal cursor state and
remove the fake inverse cursor cell from native output. It can
also create a live `NativeTerminalRenderer` adapter for the current TUI state,
so resize, render-loop pacing, and frame presentation can now run through the
native backend against the real mounted containers. `src/tui/utils/native-input-router.ts`
maps the app's current editor target onto `NativeInputRouter`, so a
native runtime can send structured events through the renderer-owned router and
still reuse the existing editor `handleInput` path during migration. `LioraTUI`'s
editor-replacement mount/restore path also updates the native router's modal
stack, so dialogs and selectors can capture native input ahead of the editor
while the native backend is attached. Wheel input is mapped to line-sized
transcript viewport scrolling through a renderer-owned global handler instead
of the legacy editor string path. The interactive app can now attach that
runtime as the visible backend through the `native_renderer` experimental flag
(`SUPERLIORA_EXPERIMENTAL_NATIVE_RENDERER`): the renderer facade keeps the
pi-tui-compatible component tree for migration, but `start`, `stop`, render
requests, terminal input, frame presentation, and the render loop are owned by
`NativeTerminalRenderer`. The native app adapter can now also compose the
renderer diagnostics snapshot into a fixed-width HUD overlay, enabled with
`SUPERLIORA_NATIVE_RENDERER_DIAGNOSTICS=1` or toggled live with
`/renderer diagnostics`, so frame-budget and cache-efficiency regressions can
be inspected in the live TUI while the backend is being replaced.
`/renderer diagnostics status` also prints the active backend, HUD state, and
current renderer metrics into the transcript, while `/renderer diagnostics reset`
clears the current frame sample window before another measurement run. The remaining gap is replacing compatibility
components with renderer-native components, then splitting the renderer package
into its own repository when the API hardens.

Acceptance:

- No routine `CSI 3J` scrollback clears.
- 10,000 transcript rows remain interactive because only visible rows render.
- Streaming, resize, animation, and user scroll are covered by regression tests.
- A pseudo-terminal e2e test proves scroll position is stable while output
  streams.

### Phase 5: Remove the compatibility backend

Removed the `pi-tui` compatibility backend and deleted the dependency.

Acceptance:

- `@earendil-works/pi-tui` is absent from `package.json`.
- `scripts/native/native-deps.mjs` no longer lists `pi-tui` as the parent for
  `koffi`.
- `src/tui/renderer/` now re-exports only `@harness-kit/tui-renderer` and the
  small app-local native adapters; no pi-tui symbols remain in the facade.
- `LioraTUI` always attaches the native renderer backend and no longer gates it
  on the `native_renderer` experimental flag.
- `NativeTUIEditor` satisfies the `TUIEditor` contract, and the native dialog
  `Input` replaces the legacy pi-tui `Input` for feedback/other text entry.
- Renderer docs and tests describe only product-owned behavior.
- The app still supports current terminal image, Markdown, key, and focus
  behavior through the native renderer equivalents.

Status: implemented.

## First implementation slice

Phase 1 is the first low-risk slice because it unlocks every later decision
without changing behavior.

Recommended first PR:

1. Add `src/tui/renderer/index.ts` and re-export the used `pi-tui` surface.
2. Move `tui-state.ts`, `kimi-tui.ts`, and `controllers/*` imports to the facade.
3. Move one low-risk component group, such as `components/chrome`, to the facade.
4. Add a guard test that fails on new direct `@earendil-works/pi-tui` imports
   outside the facade allowlist.

Do not start by implementing a new renderer. The facade proves the cut line and
keeps the rewrite reversible.

## Open questions

- Should the default long-term mode be main screen with an owned transcript
  viewport, alternate screen, or a user-configurable mode?
- Should image rendering stay terminal-protocol specific, or should images be
  represented as renderer attachments with backend-specific emitters?
- Should Markdown be kept as a component-level concern or moved into a text
  shaping layer before cells are produced?
- How much of the current component API should remain string-line based after
  the native backend lands?
