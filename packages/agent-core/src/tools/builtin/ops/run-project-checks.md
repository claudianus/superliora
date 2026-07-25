Discover and run project checks (test / typecheck / build / smoke / lint) from package.json scripts.

Prefer existing package scripts; do not invent ad-hoc shell pipelines. For monorepos, pass `packageDir` so SuperLiora-style `pnpm -C <dir> run <script>` is used.

Returns structured JSON: `{ exitCode, checks: [{ name, exitCode, durationMs, logPath?, command?, skipped? }], summary }`. Large logs are capped and may include an archive marker recoverable via LioraExpand.
