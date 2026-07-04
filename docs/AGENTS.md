# Documentation Agent Guide

`docs/` is **not** the deployed public site and has no live VitePress build
(`docs/.vitepress/config.ts` no longer exists; only a stale `dist/` cache
remains). GitHub Pages is served entirely from the hand-built static page
under `site/` (see `.github/workflows/docs-deploy.yml`, which uploads `site/`
only). Nothing in `site/` links to `docs/`.

`docs/en/` and `docs/zh/` are kept as an unpublished, English/Chinese-mirrored
reference — still readable by browsing the repo on GitHub, and still
cross-referenced by a few in-repo call sites (e.g. the `write-tui` skill's
custom-theme token table, `docs/en/customization/themes.md`). Treat it as
low-priority reference material, not an actively marketed product surface:

- Do not reintroduce VitePress config, package files, or build tooling.
- If you touch a page, keep it factually correct and keep `docs/en/` and
  `docs/zh/` mirrored (same headings, same structure). You do not need to
  follow a formal editorial style guide to do this — match the tone of the
  surrounding page.
- Do not invest in comprehensive rewrites or new pages here; that effort
  belongs in `site/` (the real public surface) instead.
- The `gen-docs`, `translate-docs`, and `sync-changelog` skills still know how
  to edit this tree (terminology, changelog classification, bilingual sync
  rules); they operate in this same "reference only, keep accurate" mode.

## Kimi platform facts

Kept here because pages under `docs/` still state these; keep them correct if
you touch a page that mentions them.

| | SuperLiora platform | Kimi Open Platform |
|---|---|---|
| Audience | Individual developers, subscription-based | Enterprise / product integration, pay-per-token |
| OpenAI-compatible base URL | `https://api.kimi.com/coding/v1` | `https://api.moonshot.cn/v1` |
| Anthropic-compatible base URL | `https://api.kimi.com/coding/` | Not supported |
| API key entry | [SuperLiora console](https://www.kimi.com/code/console) | [platform.kimi.com](https://platform.kimi.com) |

Never mix the two: `api.kimi.com/coding/…` for SuperLiora CLI / VS Code, `api.moonshot.cn/v1` for Open Platform integration.

## Terminology (when editing bilingual pairs)

Use consistent Chinese/English terms so the two locales stay recognizable as
mirrors: Agent/agent, Shell/shell, Plan mode/Plan 模式, YOLO mode/YOLO 模式,
Thinking mode/Thinking 模式, skill/Skill, session/会话, context/上下文,
API key/API 密钥, tool call/工具调用. Keep `JSON`, `JSONL`, `OAuth`, `macOS`,
`Node.js`, `npm`, `pnpm`, `TypeScript` as-is in both locales.

Chinese typography: full-width punctuation (`，。；：？！（）`), a space
between Chinese characters and adjacent English/numbers/inline code/links.

## Changelog

`docs/en/release-notes/changelog.md` is the English source; the Chinese
version is translated from it. See the `sync-changelog` skill.
