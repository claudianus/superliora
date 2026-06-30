const DEFAULT_USER_SURFACE_LEAK_PATTERNS = Object.freeze([
  { label: 'diagnostics help mode', pattern: /\bdiagnostics?\b/i },
  { label: 'preflight command', pattern: /\/?preflight\b/i },
  { label: 'bench command', pattern: /\/?bench\b/i },
  { label: 'internal QA wording', pattern: /\binternal\s+QA\b/i },
  { label: 'harness QA wording', pattern: /\bharness\s+QA\b/i },
  { label: 'Ultrawork manual command', pattern: /\/?ultrawork\b/i },
  { label: 'Ultraswarm manual command', pattern: /\/?ultraswarm\b/i },
  { label: 'login-only model setup error', pattern: /\bLLM not set,\s*send "\/login" to login\b/i },
]);

export function defaultUserSurfaceLeakFailures(scenario, output) {
  if (scenario !== 'help' && scenario !== 'autocomplete' && scenario !== 'status') return [];
  return DEFAULT_USER_SURFACE_LEAK_PATTERNS
    .filter((entry) => entry.pattern.test(output))
    .map((entry) => `default ${scenario} capture exposes ${entry.label}`);
}
