const DEFAULT_USER_SURFACE_LEAK_PATTERNS = Object.freeze([
  { label: 'diagnostics help mode', pattern: /\bdiagnostics?\b/i },
  { label: 'preflight command', pattern: /\/?preflight\b/i },
  { label: 'bench command', pattern: /\/?bench\b/i },
  { label: 'internal QA wording', pattern: /\binternal\s+QA\b/i },
  { label: 'harness QA wording', pattern: /\bharness\s+QA\b/i },
  { label: 'advanced-tagged primary help command', pattern: /\bhelp\s+\[advanced\]\s+—\s+Show available commands/i },
  { label: 'legacy plan mode label', pattern: /\bPlan mode\b/i },
  { label: 'mode-like UltraPlan wording', pattern: /\bUltraPlan\s+mode\b/i },
  { label: 'legacy planning status row', pattern: /\bPlanning\s+Ultrawork\s+(?:on|off)\b/i },
  { label: 'mode-like Ultrawork shortcut', pattern: /\bToggle\s+Ultrawork\s+planning\b/i },
  { label: 'mode-like Ultrawork notice', pattern: /\bUltrawork\s+planning:\s+(?:ON|OFF)\b/i },
  {
    label: 'legacy Ultrawork stage copy',
    pattern: /\bUltrawork\s+plans,\s+sets goal,\s+swarms,\s+verifies\b/i,
  },
  {
    label: 'internal Ultrawork prompt contract',
    pattern: /<ultrawork_flow>|<untrusted_objective>|Operating contract:/i,
  },
  { label: 'internal Ultrawork stage list', pattern: /\bUltrawork\s+auto-runs\s+UltraPlan,\s+UltraGoal,\s+UltraSwarm\b/i },
  { label: 'Ultrawork manual command', pattern: /(?:^|\s)\/?ultrawork(?=[\s.,;:)\]]|$)/ },
  { label: 'Ultraswarm manual command', pattern: /(?:^|\s)\/?ultraswarm(?=[\s.,;:)\]]|$)/ },
  { label: 'LLM jargon in model setup error', pattern: /\bLLM not set\b/i },
]);

const DEFAULT_USER_SURFACE_SCENARIOS = new Set([
  'startup',
  'help',
  'status',
  'clear',
  'autocomplete',
  'prompt-entry',
  'escape-cancel',
  'permission-mode',
  'exit',
]);

export function defaultUserSurfaceLeakFailures(scenario, output) {
  if (!DEFAULT_USER_SURFACE_SCENARIOS.has(scenario)) return [];
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

export function hasUltraworkTaskEntryCopy(output) {
  return /\bDescribe task;\s*Ultrawork runs UltraPlan,\s*UltraGoal,\s*UltraSwarm\.?/i.test(output);
}

export function hasUltraworkFooterNextAction(output) {
  return /\bnext:\s*describe task;\s*Ultrawork runs the full workflow,\s*then verifies\b/i.test(output);
}

export function hasUltraworkHelpContract(output) {
  return (
    hasUltraworkTaskEntryCopy(output) &&
    /\bVerify runs before finish;\s*advanced controls are optional\.?/i.test(output)
  );
}

export function hasUltraworkStatusContract(output) {
  return [
    /\bUltrawork\b\s+auto-link ready/i,
    /\bWorkflow\b\s+task\s*->\s*Ultrawork stages\s*->\s*verify/i,
    /\bEngine\b\s+UltraPlan\s*\|\s*UltraGoal\s*\|\s*UltraSwarm\s*\|\s*Verify/i,
    /\bAuto\b\s+ask if needed\s*\|\s*plan\s*\|\s*goal\s*\|\s*swarm\s*\|\s*verify/i,
    /\bFlow\b\s+[█░]{4}\s+(?:3|4)\/4\s+(?:verify queued|verify blocked|ready to run|verified)/i,
    /\bStages\b\s+Plan on\s*\|\s*Goal ready\s*\|\s*Swarm auto\s*\|\s*Verify queued/i,
    /\bNext\b\s+Type task;\s*Ultrawork runs the full workflow,\s*then verifies\.?/i,
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
