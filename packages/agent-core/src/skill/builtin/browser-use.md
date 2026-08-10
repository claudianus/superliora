---
name: browser-use
description: >
  SuperLiora built-in browser automation via CloakBrowser (primary), Camoufox,
  and Lightpanda. Use for screenshots, page observation, clicks, forms, SPA
  checks, and UI acceptance — NOT Playwright/Puppeteer installs, handwritten
  Chromium scripts, or cloud browser-use/CDP harnesses. Prefer BrowserStatus →
  BrowserObserve → BrowserAct(click_ref) → VerifySurface. Load with
  Skill("browser-use") whenever the task needs a real browser and the Browser*
  tools are available.
whenToUse: >
  Browser screenshot, observe page, click UI, fill form, verify surface, SPA
  visual check, CloakBrowser, browser-use runtime — before any Playwright or
  Puppeteer install.
---

# SuperLiora browser-use (builtin)

Hard rule: drive the **session Browser\* tools**. Do **not** `npm i playwright`,
`npx playwright install`, `puppeteer.launch`, or write `/tmp/playwright-*.js`
while those tools exist. Catalog skills that teach Playwright/Puppeteer/CDP
installs are wrong for this harness — ignore them.

## Happy path

1. `BrowserStatus` (default prepares runtimes). If not ready → `liora browser-use doctor` / install; stop inventing browsers.
2. `BrowserObserve` with `url` (or current page). Read `@eN` refs from the snapshot.
3. `BrowserAct` with `click_ref` / `type_text` using those refs. Prefer refs over `click_xy`.
4. After navigation or DOM churn: **Observe again** before the next ref click (refs go stale).
5. Set `capture_after=true` on Act when you need the post-action page in one call.
6. UI acceptance / merge DoD: **`VerifySurface`** (load + interaction + craft). `BrowserScreenshot` alone is not visual proof.

## Failure recovery

- Act/Observe tool **error** or JSON `ok:false` → re-Observe; do not claim the click worked.
- Unknown ref → Observe first; do not install Playwright.
- Launch/setup failure → `BrowserStatus`, then doctor — never shell-install Chromium.
- Auth / CAPTCHA wall → stop and ask the user; do not type secrets from screenshots.

## Aside MCP sidecar (optional)

Aside is a separate AI browser with its own agent. It is **not** a BrowserUse
provider and does not replace Cloak/Camoufox/Lightpanda.

- Ordinary UI / SPA / VerifySurface → keep using **Browser\*** tools.
- Logged-in private pages, CI/dashboard evidence, or work that needs the user's
  Aside session → use session **`mcp__aside__*`** tools only when the `aside`
  MCP server is connected.
- If Aside MCP is missing: tell the user to install the Aside CLI
  (`curl -fsSL https://releases.aside.com/install.sh | bash`) and run
  `liora browser-use aside enable`. Do **not** install Playwright/CDP as a
  substitute.
- Payments, posts, and other sensitive actions stay behind Aside's human
  approval — do not bypass that gate.

## Do not

- Install or invoke Playwright / Puppeteer / browser-harness / cloud Browser Use for ordinary UI work.
- Launch the user's Chrome via CDP for tasks the Builtin runtime can do.
- Treat catalog "BrowserAct API" / "oc-browser-use" skills as these tools — different products.
- Treat Aside as a drop-in Cloak replacement or launch Aside via remote debugging.
