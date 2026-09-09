---
"@superliora/site": patch
---

Drop the hard-coded nine-provider list from the landing page. `/login` reads models.dev, so
the hero stat, the provider strip, and the docs blurb now quote a snapshot written by
`pnpm -C apps/site run catalog:sync` — which the Pages workflow runs on every deploy.
