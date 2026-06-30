const DEFAULT_USER_SURFACE_LEAK_PATTERNS = Object.freeze([
  { label: 'diagnostics help mode', pattern: /\bdiagnostics?\b/i },
  { label: 'preflight command', pattern: /\/?preflight\b/i },
  { label: 'bench command', pattern: /\/?bench\b/i },
  { label: 'internal QA wording', pattern: /\binternal\s+QA\b/i },
  { label: 'harness QA wording', pattern: /\bharness\s+QA\b/i },
  { label: 'advanced-tagged primary help command', pattern: /\bhelp\s+\[advanced\]\s+—\s+Show available commands/i },
  { label: 'Ultrawork manual command', pattern: /(?:^|\s)\/?ultrawork(?=[\s.,;:)\]]|$)/ },
  { label: 'Ultraswarm manual command', pattern: /(?:^|\s)\/?ultraswarm(?=[\s.,;:)\]]|$)/ },
  { label: 'LLM jargon in model setup error', pattern: /\bLLM not set\b/i },
]);

export function defaultUserSurfaceLeakFailures(scenario, output) {
  if (scenario !== 'help' && scenario !== 'autocomplete' && scenario !== 'status') return [];
  return DEFAULT_USER_SURFACE_LEAK_PATTERNS
    .filter((entry) => entry.pattern.test(output))
    .map((entry) => `default ${scenario} capture exposes ${entry.label}`);
}

export function hasXpDodReadinessContract(output) {
  return [
    /\bScope\b\s+small focused diff;\s*no broad refactor/i,
    /\bCoverage\b\s+test public behavior changes/i,
    /\bScreen check\b\s+open changed screen before finishing/i,
    /\bDone gate\b\s+(?:relevant tests\s+\+\s+available typecheck\/lint\/build|tests\s+\+\s+typecheck\/lint\/build)\s+\+\s+clean diff\s+\+\s+TUI/i,
  ].every((pattern) => pattern.test(output));
}

export function shouldRequireModelSetupAction(output) {
  return /\bModel:?\s+not set\b/i.test(output) || /\bState\b\s+Model needed\b/i.test(output);
}

export function hasLoggedOutSetupNextAction(output) {
  return /\bnext:\s*\/login or \/provider,\s*then \/model\b/i.test(output);
}

export function hasStatusPanelSetupNextAction(output) {
  return /\bState\b\s+Model needed\b[\s\S]*\bNext\b\s+Run \/login or \/provider first;\s*use \/model after sign-in\./i.test(
    output,
  );
}
