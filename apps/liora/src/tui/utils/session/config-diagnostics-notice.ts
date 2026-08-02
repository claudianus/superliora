/**
 * Loop47a — surface config.toml diagnostics as a named TUI notice.
 *
 * `getConfigDiagnostics().warnings` used to flash only as a status-line
 * `showStatus` (easy to miss / scroll away). Prefer a coalesceable notice with
 * soft vs hard (kept previous config) recovery copy.
 */

export type ConfigDiagnosticsNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'config-diagnostics';
  readonly keptPrevious: boolean;
};

const KEPT_PREVIOUS_MARKER = 'keeping the previously loaded configuration';

export function isConfigKeptPreviousWarning(warning: string): boolean {
  return warning.includes(KEPT_PREVIOUS_MARKER);
}

export function formatConfigDiagnosticsNotice(
  warnings: readonly string[],
): ConfigDiagnosticsNotice | undefined {
  if (warnings.length === 0) return undefined;
  const keptPrevious = warnings.some(isConfigKeptPreviousWarning);
  const body = warnings.map((w) => `- ${w}`).join('\n');
  return {
    title: keptPrevious ? 'Config reload degraded' : 'Config diagnostics',
    detail: keptPrevious
      ? `config.toml has errors; previous configuration was kept.\n${body}\nFix config.toml, then reload or restart.`
      : `Runtime config warnings:\n${body}`,
    status: keptPrevious
      ? 'Config degraded — kept previous config.toml'
      : `Config diagnostics (${String(warnings.length)})`,
    coalesceKey: 'config-diagnostics',
    keptPrevious,
  };
}
