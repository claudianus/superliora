Discover and run project checks (test / typecheck / build / smoke / lint) from package.json scripts.

Prefer existing package scripts; do not invent ad-hoc shell pipelines. For monorepos, pass `packageDir` for `pnpm -C <dir> run <script>`.

Returns structured JSON: `{ exitCode, checks: [{ name, exitCode, durationMs, logPath?, command?, skipped? }], summary }`. Large logs are capped.
