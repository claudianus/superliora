# Documentation Agent Guide

`docs/` is **not** the public site. GitHub Pages ships `apps/site/dist` (see `.github/workflows/docs-deploy.yml`). Nothing in `apps/site/` links here. `docs/.vitepress/` is gone; ignore any stale `docs/dist/`.

`docs/en/` and `docs/zh/` are an unpublished bilingual reference (GitHub browse + a few in-repo links, e.g. write-tui theme tokens). Low-priority accuracy, not a marketed surface.

## Rules

- Do not reintroduce VitePress config, package files, or build tooling.
- Edits: keep facts correct and keep `docs/en/` ↔ `docs/zh/` mirrored (same headings/structure). Match the surrounding page tone; no formal style guide required.
- No big rewrites or new product docs here — that belongs in `apps/site/`.
- Skills that still touch this tree (`gen-docs`, `translate-docs`, `sync-changelog`) stay in “reference only, keep accurate” mode. Prose: `.agents/skills/no-ai-slop/SKILL.md` when needed.

## Platform facts (if a page mentions them)

| | SuperLiora platform | Kimi Open Platform |
|---|---|---|
| Audience | Individual devs, subscription | Enterprise / product, pay-per-token |
| OpenAI-compatible base | `https://api.kimi.com/coding/v1` | `https://api.moonshot.cn/v1` |
| Anthropic-compatible base | `https://api.kimi.com/coding/` | Not supported |
| API key | [SuperLiora console](https://www.kimi.com/code/console) | [platform.kimi.com](https://platform.kimi.com) |

Do not mix hosts: `api.kimi.com/coding/…` for SuperLiora CLI/IDE; `api.moonshot.cn/v1` for Open Platform.

## Bilingual terms

Keep pairs recognizable: Agent/agent, Shell/shell, Plan mode/Plan 模式, YOLO mode/YOLO 模式, Thinking mode/Thinking 模式, skill/Skill, session/会话, context/上下文, API key/API 密钥, tool call/工具调用. Leave `JSON`, `JSONL`, `OAuth`, `macOS`, `Node.js`, `npm`, `pnpm`, `TypeScript` unchanged in both locales.

Chinese: full-width punctuation; space between CJK and adjacent English/numbers/code/links.

## Changelog

English source: `docs/en/release-notes/changelog.md`. Chinese is translated from it — `sync-changelog` skill.
