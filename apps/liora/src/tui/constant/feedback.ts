// Hint shown beneath session-level error messages in the TUI to point users
// at the `/export-debug-zip` workflow so they can share diagnostics with us.
export function errorReportHintLine(): string {
  return "If this persists, run `/export-debug-zip` and share the file with us for diagnosis. Please don't share it publicly.";
}
