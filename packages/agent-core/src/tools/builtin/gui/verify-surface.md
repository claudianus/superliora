Verify a rendered UI surface: BrowserStatus → optional navigate → Observe → Screenshot → console errors.

Requires a healthy browser-use runtime. If missing or not ready, returns an error — never a fake pass.

Returns structured JSON: `{ pass, url?, screenshotPath?, consoleErrors[], notes[] }`. Prefer over ad-hoc Puppeteer/Playwright scripts.
