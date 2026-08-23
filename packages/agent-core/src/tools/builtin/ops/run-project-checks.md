Discover and run project checks (test / typecheck / build / smoke / lint) from package.json scripts.

Prefer existing package scripts; do not invent ad-hoc shell pipelines. For monorepos, pass `packageDir` for `pnpm -C <dir> run <script>`.

Packages without dependencies whose `test` script is `node --test` / `node --check` run that command directly (no pnpm, no `node_modules` install). Typecheck/build/lint are skipped on those static sites so dest checkouts stay clean.

When package.json is missing and the directory is a static site (HTML/CSS/JS), runs a `static` check instead: every shipped JS file must parse (`node --check`). A static site can pass verification; it does not stay "unverified" just because it has no scripts.

Returns structured JSON: `{ exitCode, checks: [{ name, exitCode, durationMs, logPath?, command?, skipped? }], summary }`. Large logs are capped.
