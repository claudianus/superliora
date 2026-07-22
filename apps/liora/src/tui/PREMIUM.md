# SuperLiora TUI — Premium Standard

> The single source of truth for the SuperLiora terminal UI's visual language,
> interaction model, and motion design. Every dialog, selector, input box, and
  animated element must conform to this document. Walk the self-check list at the
> end before submitting.
>
> **Baseline component:** `components/dialogs/model-selector.ts` (`/model`).

---

## 1. Color & Typography

### 1.1 Single source of truth

`ColorPalette` in `src/tui/theme/colors.ts` is the only color token source.
Every color flows through `currentTheme` at render time:

```ts
// YES — theme-aware, palette-driven
currentTheme.fg('primary', text)
currentTheme.boldFg('accent', label)
currentTheme.dimFg('textMuted', hint)

// NO — bypasses the theme system
chalk.red(text)
chalk.bold(text)        // no color → falls back to terminal default
chalk.dim(text)         // no color → falls back to terminal default
```

### 1.2 Hard rules

- **No chalk named colors** (`chalk.red`, `chalk.cyan`, `chalk.white`, …).
  Enforced by `test/tui/chalk-named-color-guard.test.ts`.
- **No uncolored style wrappers** (`chalk.bold(text)`, `chalk.dim(text)` without
  a `.hex(...)` color). They drop to the terminal's default foreground and break
  theme consistency. Use `currentTheme.boldFg(token, text)` /
  `currentTheme.dimFg(token, text)` instead.
- **No module-top-level cached styled functions.** Theme switching must take
  effect within a single render frame, so styles are generated on the render
  path from the current palette.
- When a new visual semantic has no token, first add a field to `ColorPalette`
  and fill both `darkColors` and `lightColors`.

### 1.3 Contrast (WCAG AA)

- Light theme: text tokens against white background ≥ 4.5:1.
- Light theme: borders and large chrome ≥ 3:1.
- The renderer's `rendererContrastRatio` helper is available for automated

---

## 2. Selection Language

Consistent visual grammar across every list picker. Symbols live in
`src/tui/constant/symbols.ts`.

| Semantic | Symbol | Style | Constant |
|---|---|---|---|
| Selected row pointer | `❯` | `primary` + bold | `SELECT_POINTER` |
| Current / active value | `← current` | `success` (row tail, leading space) | `CURRENT_MARK` |
| Danger / destructive | text | `error` (+ bold when selected) | — |
| Danger confirm `[y/N]` | text | `warning` + bold | — |
| Toggle on | ` enabled` | `success` (trailing, 2-space gap) | — |
| Toggle off | ` disabled` | `textDim` (trailing, 2-space gap) | — |

- **Never** invent alternative pointers (`>`, `▶`, `→`, `●`).
- **Never** use `●` / `(current)` for the current value — use `CURRENT_MARK`.
- Selected (cursor row) and current (active value) are **independent** — both
  can land on the same row.

---

## 3. List Dialogs

Baseline: `model-selector.ts`. Top-to-bottom fixed layout:

```
─────────────────────────────────────────────  ① Top border (primary, full-width ─)
 Select a model  (type to search)              ② Title (primary+bold) + suffix (textMuted)
 ↑↓ navigate · Enter select · Esc cancel        ③ Hint (textMuted, tight under title)
                                                ④ Blank line
 Search: gpt                                    ⑤ Search line — only when query is non-empty
   ❯ GPT-5            openai                    ⑥ List items: pointer + name (left) + secondary (right, textMuted)
     Kimi K2          SuperLiora ← current         Current item: trailing CURRENT_MARK (success)
                                                ⑦ Blank line
  ▼ 3 more                                      ⑧ Scroll / match indicator
─────────────────────────────────────────────  ⑨ Bottom border (primary, full-width ─)
```

### Hard constraints

- **Exactly two full-width `─` borders** (top + bottom). No inner `─` under the
  title.
- `(type to search)` appears only as a title suffix (when searchable and query
  is empty). The hint line never repeats "type to search".
- `Search:` line sits below the blank line, above the list. Rendered only when a
  query exists.
- Hint is tight under the title (no blank line between); 1 blank line between
  hint and body.

### Hint line conventions

- Entire hint line is `textMuted` — **no per-key highlighting**.
- Segments are `key + description`, joined by ` · ` (space-middot-space).
- Key tokens are capitalized (`Enter`, `Esc`, `Tab`, `Backspace`, `D`);
  descriptions are lowercase (`navigate`, `select`, `cancel`, `page`, `delete`,
  `clear`).
- Direction arrows are `↑↓` (never `▲/▼`).
- "Leave the dialog" is always `cancel` (never close / back / exit / dismiss).
  Business semantics (e.g. approval reject) are the exception.

### Key bindings

| Action | Key | Comparison |
|---|---|---|
| Move | `↑` / `↓` | `matchesKey(data, Key.Up/Down)` |
| Page | `PgUp` / `PgDn` | `matchesKey(data, Key.PageUp/Down)` |
| Select | `Enter` | `matchesKey(data, Key.Return)` |
| Cancel | `Esc` | `matchesKey(data, Key.Escape)` — two-stage in searchable lists: first clears query, then closes |
| Delete | `D` | `printableChar(data) === 'D'` (also accepts `'d'`) |
| Search | typing | `printableChar(data)` |
| Toggle | `Space` | `printableChar(data) === ' '` |

- **Printable char comparisons must go through `printableChar()`** (Kitty
  protocol). Enforced by `test/tui/printable-key-guard.test.ts`.
- `←` / `→` are context-dependent: value switching (e.g. thinking on/off) when
  the component has horizontal values; paging otherwise. **Never** overload
  `←→` for paging in a component that also uses them for value switching.
- Delete uses the letter `D` — the list must **not** be type-to-search (otherwise

---

## 4. Toggle / Multi-select Lists

For lists where each row can be independently toggled (e.g. `/plugins`).
`Space` toggles in-place; the dialog stays open.

```
 Plugins
 ↑↓ navigate · Space toggle · Enter details · Esc cancel
                                                ← blank line
 Installed plugins (2)                          ← section title (textStrong / bold)
   ❯ Kimi Datasource  enabled                   ← selected (❯ + primary+bold) + status (success)
     id kimi-datasource · 1 skill · MCP 1/1     ← secondary info (textMuted, · separated)
     Superpowers  disabled                      ← unselected (text) + status (textDim)
```

- `Space toggle` — immediate, dialog stays open.
- Status tag trails the name with a 2-space gap: ` enabled` (success) /
  ` disabled` (textDim).
- `Enter` serves another purpose (e.g. `Enter details`), not toggle.
- Up to 1 secondary info line below each row (`textMuted`, ` · ` separated).

---

## 5. Tab Strips

For tabbed dialogs (e.g. `/model` provider tabs). The active tab is filled with
the brand background; inactive tabs are muted. When the strip is wider than the
terminal, it scrolls to keep the active tab visible, framed by `<`/`>` markers.


---

## 7. Motion & Animation

### 7.1 Single animation clock

All motion flows through the render loop's `requestAnimationFrame` or the shared
renderer ambient schedule / `RendererTicker`. **No raw `setInterval` /
`setTimeout` in components for animation.** This ensures:

- Consistent pause / resume.
- Adaptive quality gating (frames drop to lower FPS under load).
- `unref()` on all timers (no dangling handles).
- No competing independent clocks.

### 7.2 Quality levels

Effects resolve through `resolveQualityAdjustedAmbientEffectMode`:

| Level | Behavior |
|---|---|
| `off` | No motion. Static colors only. |
| `subtle` | Low-frequency ambient particles, slow shimmer. |
| `premium` | Multi-frame mascots, gradient text, pulse cycling, particle rails. |

Quality auto-degrades based on frame health (`NativeFrameStatsHealth`) and
renderer quality level. SSH / `NO_COLOR` / `CI` / `TERM=dumb` force `off` or
static fallbacks.

### 7.3 Premium motion quality bar

"Premium" means **more than a 2-frame blink**:


---

## 8. Shared Primitives (reuse, don't reinvent)

| Form | Primitive |
|---|---|
| List cursor / search / paging state machine | `utils/searchable-list.ts` → `SearchableList` |
| Paging view | `utils/paging.ts` → `pageView` |
| Kitty printable char | `utils/printable-key.ts` → `printableChar` / `isPrintableChar` |
| Selection pointer / current mark | `constant/symbols.ts` → `SELECT_POINTER` / `CURRENT_MARK` |
| Panel chrome (borders, title, hint, footer) | `renderRendererPanelChromeRows` from `@harness-kit/tui-renderer` |
| Divider rows | `renderRendererDividerRow` |
| Progress bars | `renderRendererSegmentedProgressBar` / `renderRendererRatioProgressBar` |
| Gradient text | `theme/gradient-text.ts` → `gradientText` |
| Ambient effects | `utils/appearance-effects.ts` → `renderPulseText` / `renderShimmerPrefix` / `renderParticleRail` |

New list components **must reuse `SearchableList`** and manually align to
§3–§6 of this document.

---

## 8.1 Workspace Shell

The workspace (docks + center stage) reads as **one bordered composition**,
not floating panels:

- **One outer frame.** `workspace/shell-chrome.ts` → `workspaceShellChromeCells`
  paints a single rounded (`╭─╮│╰─╯`) perimeter around `layout.shell`. Dock
  panel frames render afterward and overwrite their own portion of that
  perimeter, so the outer frame only shows through above/below and around the
  center stage — never a second border stacked on a dock's own edge.
- **Shared border family.** All dock `renderPanelFrame` calls use
  `borderStyle: 'rounded'` (focused and unfocused alike) — never mix
  `'rounded'`/`'single'` within the same workspace.
- **Focus ring on the active column only.** Focused panel border uses
  `primary` (+ ultrawork glow transition); unfocused panels dim to
  `border`/`textMuted`. Never brighten more than one panel per dock at a time.
- **1-col horizontal padding.** Panel content never sits flush against the
  vertical border — reduce the width passed to `definition.render` by 2
  (1 col each side) and prefix each returned line with a leading space; do
  not change panel-internal rendering to achieve this.
- All chrome colors resolve through `currentTheme` — no chalk named colors,
  per §1.2.

---

## 9. Architecture Discipline

- `LioraTUI` (`liora-tui.ts`) is a **coordinator** — it wires state, layout,
  session, and dialogs. Heavy logic belongs in `controllers/`, not on the class.
- Components handle presentation and local interaction only. They must not call
  the SDK directly or read/write session state.
- `theme/` is the single source of truth for colors. Components must not bypass
  it.
- The renderer package (`@harness-kit/tui-renderer`) provides renderer-owned
  primitives; prefer importing through `src/tui/renderer/` (the facade) rather
  than the package directly.

---

## 10. Self-check List

### Color & typography
- [ ] All colors come from `currentTheme.fg/boldFg/dimFg(token, ...)` — no chalk
      named colors, no uncolored `chalk.bold/dim`.
- [ ] No module-top-level cached styled functions.
- [ ] New tokens are added to `ColorPalette` + `darkColors` + `lightColors` +
      theme schema + docs.

### Selection language
- [ ] Selected pointer uses `SELECT_POINTER`; current value uses `CURRENT_MARK`.
- [ ] No invented pointers (`>`, `▶`, `→`, `●`) or current markers (`(current)`).

### List dialog layout
- [ ] Top `─` → title (+ `(type to search)` suffix) → hint → blank → `Search:`
      → list → scroll indicator → bottom `─`. No inner `─` under the title.
- [ ] Hint is `textMuted`, no per-key highlighting. Keys capitalized,
      descriptions lowercase, ` · ` separated.
- [ ] "Leave the dialog" is always `cancel`.

### Key bindings
- [ ] `↑↓` move, `PgUp/PgDn` page, `Enter` select, `Esc` cancel (two-stage in
      searchable), `D` delete, `Space` toggle.
- [ ] Printable char comparisons go through `printableChar()`.

### Motion
- [ ] No raw `setInterval` / `setTimeout` for animation — use the renderer
      ambient schedule / `RendererTicker`.
- [ ] Premium effects have ≥ 4 frames or genuine motion (not a 2-frame blink).
- [ ] SSH / `NO_COLOR` / `CI` / `TERM=dumb` gracefully degrade to static.

### Reuse
- [ ] New list components reuse `SearchableList`.
- [ ] Borders / dividers / progress bars use renderer primitives.
- [ ] Input boxes use rounded `╭ ╮ ╰ ╯`, multi-field `Tab/↑↓` navigation.

### Tests
- [ ] Component test covers render snapshot + `handleInput` key behavior.
- [ ] `tsc --noEmit` passes.
- [ ] `vitest run` passes for affected packages.

- Mascots: ≥ 4 animation frames with easing, gradient color cycling, or shape
  morphing. A single glyph toggling between `✦` and `✧` is not premium.
- Loaders: smooth frame cycling at the configured FPS, with pulse-color label
  and elapsed time.
- Gradient text: per-grapheme color interpolation with phase animation.
- Particle rails: density and velocity scaled to terminal width, deterministic
  seeded placement (no jitter on re-render).

### 7.4 State scope

Appearance preferences, animation clock, render quality, and render health are
**instance-scoped**, not module-level `let` globals. This prevents state leakage
between TUI instances and enables unit testing.

See `src/tui/utils/tab-strip.ts` for the shared renderer.

---

## 6. Input Boxes (multi-field)

- Rounded box `╭ ╮ ╰ ╯` (primary).
- Field navigation: `Tab` / `Shift+Tab` / `↑` / `↓`.
- `Enter`: non-last field → advance; last field → submit.
- Cancel: `Esc` / `Ctrl+C` / `Ctrl+D`.
- Footer adapts to focus: non-last shows `Enter next`, last shows `Enter submit`.
- Required validation locates fields in order; errors use the matching sub-hint
  state.

  `D` enters the search box). All current delete-enabled lists are non-searchable.

- Every line passes through `truncateToWidth(line, width)` — CJK and narrow
  terminals never overflow.

  checks; a contrast guard test should be added when new tokens are introduced.
