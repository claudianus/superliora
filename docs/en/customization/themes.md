# Custom Themes

SuperLiora CLI can use a built-in color scheme or a custom JSON theme file. Custom files live in the themes directory and appear in `/theme` alongside the built-in choices.

## Built-in color tokens

Custom themes can override the tokens below. The `dark` and `light` columns show the built-in values; `auto` resolves to one of those palettes at startup, and falls back to `dark` when terminal background detection is unavailable.

| Token | `dark` | `light` | What it controls |
| --- | --- | --- | --- |
| `primary` | `#4FA8FF` | `#1565C0` | The most-used color. Links, inline code, the selected item in nearly every dialog, the focused editor border, Plan/"running" badges, spinners |
| `accent` | `#5BC0BE` | `#00838F` | Secondary highlight. Approval `▶` prefix, device-code box, image placeholder, BTW / queue panes, registry import |
| `text` | `#E0E0E0` | `#1A1A1A` | Body text. Dialog bodies, todo titles, footer model label, Markdown headings, assistant/tool message bullets, list bullets |
| `textStrong` | `#F5F5F5` | `#1A1A1A` | Emphasized / bold text. Input dialogs, status messages |
| `textDim` | `#888888` | `#454545` | Secondary, dimmed text. Thinking, hints, descriptions, completed todos, Markdown quotes, footer status bar |
| `textMuted` | `#6B6B6B` | `#5F5F5F` | Faintest text. Counters, scroll info, descriptions, Markdown link URLs, code-block borders |
| `background` | `#0B0F14` | `#FFFFFF` | Root TUI canvas background |
| `surface` | `#111827` | `#F4F7FB` | Default panel and dialog surface |
| `surfaceRaised` | `#182233` | `#E8F0FA` | Raised surface for focused or premium chrome |
| `surfaceSunken` | `#080C10` | `#EEF2F7` | Sunken surface for inactive panes and recessed areas |
| `border` | `#5A5A5A` | `#737373` | Pane and editor borders, Markdown horizontal rule |
| `borderFocus` | `#E8A838` | `#92660A` | Focus / attention border, currently only the approval panel |
| `selectionBg` | `#1D4E89` | `#D8E8FF` | Selection background for pickers and imported terminal palettes |
| `selectionText` | `#F5F5F5` | `#0B1020` | Selection text |
| `cursor` | `#E0E0E0` | `#1A1A1A` | Cursor color for opt-in terminal palette mutation |
| `success` | `#4EC87E` | `#0E7A38` | Success state. `✓`, "enabled", completed |
| `warning` | `#E8A838` | `#92660A` | Warning state. auto/yolo badges, stale markers, Plan mode hint |
| `error` | `#E85454` | `#B91C1C` | Error state. Error messages, failed tool output |
| `diffAdded` | `#4EC87E` | `#0E7A38` | Diff added lines |
| `diffRemoved` | `#E85454` | `#B91C1C` | Diff removed lines |
| `diffAddedStrong` | `#7AD99B` | `#0E7A38` | Diff intra-line changed words, added and bold |
| `diffRemovedStrong` | `#F08585` | `#B91C1C` | Diff intra-line changed words, removed and bold |
| `diffGutter` | `#6B6B6B` | `#737373` | Diff line-number gutter |
| `diffMeta` | `#888888` | `#5F5F5F` | Diff meta / hunk headers |
| `roleUser` | `#FFCB6B` | `#9A4A00` | User message bullet and text, skill-activation name |
| `shellMode` | `#BD93F9` | `#7C3AED` | Shell mode (`!`) prompt, editor border, and the echoed `$ command` line |
| `glow` | `#7DD3FC` | `#075985` | Glow / halo accent for premium mascot and focus effects |
| `particle` | `#B784FF` | `#7C3AED` | Particle accent for event bursts and ambient effects |
| `gradientStart` | `#00D5FF` | `#075985` | Start of premium gradient treatments |
| `gradientEnd` | `#B784FF` | `#0F766E` | End of premium gradient treatments |
| `syntaxText` | `#E0E0E0` | `#1A1A1A` | Code highlight default / identifiers |
| `syntaxKeyword` | `#C792EA` | `#6D28D9` | Code highlight keywords, constants, and built-ins |
| `syntaxFunction` | `#82AAFF` | `#075985` | Code highlight function and method names |
| `syntaxType` | `#FFCB6B` | `#9A4A00` | Code highlight class/type names and attributes |
| `syntaxString` | `#C3E88D` | `#0E7A38` | Code highlight string literals |
| `syntaxNumber` | `#F78C6C` | `#B45309` | Code highlight numeric and boolean literals |
| `syntaxComment` | `#697098` | `#6B7280` | Code highlight comments and doc tags |
| `syntaxOperator` | `#89DDFF` | `#0F766E` | Code highlight operators, punctuation, and symbols |
| `syntaxTag` | `#F07178` | `#B91C1C` | Code highlight tags, selectors, and markup names |
| `syntaxMeta` | `#7FDBCA` | `#5F5F5F` | Code highlight metadata, decorators, and preprocessor lines |

## Use the custom-theme skill

You do not need to write the JSON by hand. Run the built-in `/custom-theme [extra text]` skill command to enter the custom-theme workflow; the skill can choose colors, write the file under `~/.superliora/themes/`, validate the hex values, and tell you how to apply it.

Example invocations:

- `/custom-theme Create a warm dark theme with amber accents.`
- `/custom-theme Make a light theme based on Solarized, but keep errors easy to see.`
- `/custom-theme Tweak my ember theme so diffs have higher contrast.`

After activation, the skill usually asks whether you want a light or dark base, what mood or palette you prefer, and whether you have exact colors to include. If you use it to edit an existing theme, make sure it reads and backs up the file before overwriting it.

## Create a theme

Add a `.json` file to the themes directory:

- `~/.superliora/themes/`
- or `$SUPERLIORA_HOME/themes/` when the `SUPERLIORA_HOME` environment variable is set

Create the directory if it does not exist. **The filename is the theme name**: `ember.json` appears in `/theme` as `Custom: ember`.

A minimal theme only sets the colors you want to change; the rest fall back to the **base palette** (`dark` by default):

```json
{
  "name": "ember",
  "colors": {
    "primary": "#83A598",
    "accent": "#FE8019"
  }
}
```

Fields:

- `name` (required): the theme identifier.
- `displayName` (optional): a human-readable name.
- `base` (optional): the built-in palette that unspecified tokens inherit — `"dark"` (default) or `"light"`. Set `"base": "light"` when you are building a **light** theme so the tokens you leave out stay readable on a light background (otherwise they fall back to the dark palette).
- `colors` (optional): the color tokens to override, each a 6-digit hex value (e.g. `#FE8019`).

Use the token names from [Built-in color tokens](#built-in-color-tokens). Any token you omit falls back to the selected base palette, so partial themes are fine:

```json
{
  "name": "just-blue",
  "colors": {
    "primary": "#3B82F6",
    "roleUser": "#3B82F6"
  }
}
```

## Select a theme

Two ways:

1. **The `/theme` command** (recommended): opens the theme picker with SuperLiora presets, bundled external terminal themes, and custom themes. Moving focus previews the highlighted theme immediately, including the demo panel and syntax colors. Custom themes appear as `Custom: <filename>`. The picker **re-scans the themes directory every time it opens**, so a theme file you just added shows up **without a restart**.
2. **`tui.toml`**: set `theme` to your theme name:

   ```toml
   # ~/.superliora/tui.toml
   theme = "ember"
   ```

## What happens on errors

Custom themes are designed to never get in your way:

- **An invalid color value** (not `#` followed by 6 hex digits): that one entry is silently skipped and falls back to the selected base palette; the rest of the colors still apply.
- **An unrecognized token**: ignored, with no effect on other colors.
- **A missing custom theme file or malformed JSON**: silently falls back to the built-in `dark` palette. It does not retry `auto`.

## Editing the active theme

If you edit the theme file that is **currently active**, the change is not reloaded automatically. To apply the new colors:

- run `/reload-tui` — it reloads `tui.toml` and re-applies the current theme (including re-reading the theme file); or
- switch to another theme in `/theme` and back.

::: warning Note
Re-selecting the **same** theme in `/theme` does not reload it (you get a "Theme unchanged" message). To reload changes to the active theme, use one of the two methods above.
:::
