Verify a rendered UI surface: BrowserStatus → Observe → interaction smoke → Screenshot → console errors → craft audit.

Requires a healthy browser-use runtime. If missing or not ready, returns an error — never a fake pass. Hard fail-fast after 120s (including install); do not retry in a BrowserAct explore loop.

Returns structured JSON:
`{ pass, axes: { load, interaction, craft }, url?, screenshotPath?, consoleErrors[], craftHits?, notes[], visualDescription? }`.

- **load**: console error/assert/exception count is zero after observe.
- **interaction**: bounded scenario (or default click on first button/link/textbox). Fails when no affordance exists or act/console regresses.
- **craft**: banned ship-state markers in snapshot/description (lorem, placeholder, dead `#` links, …).

`pass` is true only when required axes pass. Prefer over ad-hoc Puppeteer/Playwright scripts.
