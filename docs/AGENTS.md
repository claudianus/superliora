# Documentation Agent Guide

`docs/` is an unpublished reference/archive, not the public site. GitHub Pages ships
`apps/site/dist` through `.github/workflows/pages.yml`; nothing under `docs/` is
deployed.

`docs/en/` is the only maintained user-facing reference locale. `docs/specs/` and
`docs/research/` are internal notes and historical design material. Keep this tree
low priority: update it only when documentation work is explicitly in scope.

## Rules

- Do not reintroduce VitePress config, package files, or build tooling.
- Keep requested English reference edits factually correct and focused.
- Do not mirror or translate pages under `docs/`.
- No big rewrites or new product docs here — that belongs in `apps/site/`.
- `gen-docs` and `sync-changelog` are optional reference workflows, not automatic
  requirements for product changes.

## Platform facts (if a page mentions them)

| | SuperLiora platform | Kimi Open Platform |
|---|---|---|
| Audience | Individual devs, subscription | Enterprise / product, pay-per-token |
| OpenAI-compatible base | `https://api.kimi.com/coding/v1` | `https://api.moonshot.cn/v1` |
| Anthropic-compatible base | `https://api.kimi.com/coding/` | Not supported |
| API key | [SuperLiora console](https://www.kimi.com/code/console) | [platform.kimi.com](https://platform.kimi.com) |

Do not mix hosts: `api.kimi.com/coding/…` for SuperLiora CLI/IDE; `api.moonshot.cn/v1` for Open Platform.

## Changelog

`docs/en/release-notes/changelog.md` is an archival English reference page.
`apps/liora/CHANGELOG.md` remains the release source of truth; do not add a
routine docs sync to product changes.
