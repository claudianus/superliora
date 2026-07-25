Verify a rendered UI surface in one call: BrowserStatus → optional navigate → Observe → Screenshot → console errors.

Requires a healthy browser-use runtime (CloakBrowser primary). If the runtime is missing or not ready, returns an error — never a fake pass.

Returns structured JSON: `{ pass, url?, screenshotPath?, consoleErrors[], notes[] }`. Prefer this over ad-hoc Puppeteer/Playwright scripts when the runtime is available.
