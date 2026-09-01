Verify a rendered UI surface: BrowserStatus → Observe → interaction smoke → Screenshot → console errors → craft audit.

Requires a healthy browser-use runtime. If missing or not ready, returns an error — never a fake pass. Hard fail-fast after 240s (covers cold install); do not retry in a BrowserAct explore loop.

Returns structured JSON:
`{ pass, axes: { load, interaction, craft }, url?, screenshotPath?, consoleErrors[], craftHits?, notes[], visualDescription? }`.

- **load**: console error/assert/exception count is zero after observe. Console noise the product does not own (favicon 404s, browser-extension origins) is filtered, not counted.
- **interaction**: bounded scenario (or a default smoke click on a safe non-destructive button/link/textbox). `not_applicable` when the surface exposes no clickable affordance (canvas/visual UI) — not a fail. Fails when act/console regresses.
- **craft**: banned ship-state markers in visible copy (lorem ipsum, placeholder copy, TODO markers, coming soon, …). Accessibility attribute notation (`href=`, `placeholder=`) is source metadata, not copy, and never fails the audit.

`pass` is true only when required axes pass. Prefer over ad-hoc Puppeteer/Playwright scripts.
