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
  { label: 'legacy Ultrawork ready badge', pattern: /\bultrawork-ready\b/i },
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
  { label: 'internal Ultrawork stage list', pattern: /\bUltrawork\s+auto-runs\s+UltraPlan,\s+(?:UltraResearch,\s+)?UltraGoal,\s+UltraSwarm\b/i },
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
  return /\bShift-Tab toggles Ultrawork and off\.?/i.test(output);
}

export function hasUltraworkFooterNextAction(output) {
  return [
    /\bnext:\s*describe task;\s*Ultrawork will interview before goal,\s*swarm,\s*and edits\b/i,
    /\bWorkflow\b\s+interview\s*->\s*goal\s*->\s*research\s*->\s*swarm decision\s*->\s*integrate\s*->\s*verify\s*->\s*learn/i,
    /\bnext:\s*Shift-Tab toggles Ultrawork\/off,\s*or type normally\b/i,
  ].some((pattern) => pattern.test(output));
}

export function hasUltraworkHelpContract(output) {
  return (
    hasUltraworkTaskEntryCopy(output) &&
    /\bNormal messages stay lightweight unless Ultrawork is on\.?/i.test(output)
  );
}

export function hasUltraworkAdvancedHelpContract(output) {
  return [
    /\bUltrawork is one workflow:\s*UltraPlan,\s*UltraGoal,\s*Research,\s*Swarm decision,\s*Integrate,\s*Verify,\s*Learn\.?/i,
    /\bShift-Tab toggles Ultrawork\/off\b/i,
    /\bexplicit steering controls below\.?/i,
    /\bAdvanced Ultrawork controls\b/i,
    /\bAdvanced steering for UltraPlan;\s*Ultrawork auto-enables it\b/i,
    /\bAdvanced steering for UltraSwarm;\s*Ultrawork decides after UltraGoal\b/i,
  ].every((pattern) => pattern.test(output));
}

export function hasUltraworkStatusContract(output) {
  const requiredContract = [
    /\bUltrawork\b\s+(?:mode on|mode off|goal active|goal blocked|needs readiness)/i,
    /\bWorkflow\b\s+interview\s*->\s*goal\s*->\s*research\s*->\s*swarm decision\s*->\s*integrate\s*->\s*verify\s*->\s*learn/i,
    /\bEngine\b\s+UltraPlan\s*\|\s*UltraGoal\s*\|\s*Research\s*\|\s*Swarm decision\s*\|\s*Integrate\s*\|\s*Verify\s*\|\s*Learn/i,
    /\bAuto\b\s+Shift-Tab toggles Ultrawork\/off;\s*no regex promotion for plain tasks/i,
    /\bFlow\b\s+[█░]{4}\s+(?:3|4)\/4\s+(?:verify queued|verify blocked|ready to run|verified)/i,
    /\bStages\b\s+Plan (?:on|required|off)\s*\|\s*Goal (?:ready|active|blocked|done)\s*\|\s*Swarm (?:armed|decision pending|off)\s*\|\s*Verify (?:queued|blocked|ready|done)/i,
  ].every((pattern) => pattern.test(output));
  const taskNextAction =
    /\bNext\b\s+(?:Type task;\s*Ultrawork will interview before goal,\s*swarm,\s*and edits\.?|Press Shift-Tab to toggle Ultrawork\/off,\s*or type normally\.?)/i.test(output);
  const setupNextAction = shouldRequireModelSetupAction(output) && hasStatusPanelSetupNextAction(output);
  return requiredContract && (taskNextAction || setupNextAction);
}

export function hasHarnessRadarStatusContract(output) {
  return [
    /\bAutonomy\b\s+bounded now\s*->\s*headless target/i,
    /\bRecovery\b\s+resumable evidence (?:ready|needed)\s*->\s*durable target/i,
    /\bTools\b\s+search first;\s*load tools on demand/i,
    /\bMemory\b\s+prefs\s*\|\s*session recall\s*\|\s*long-run notes/i,
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
