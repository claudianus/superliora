const REQUIRED_AUTONOMY_TIERS = Object.freeze(['step-gated', 'checkpoint-gated', 'bounded', 'headless']);
const REQUIRED_RECOVERY_TIERS = Object.freeze(['none', 'retry', 'resumable', 'durable']);
const REQUIRED_ADOPTION_TIERS = Object.freeze(['super simple', 'mostly simple', 'slightly complex', 'complex']);
const REQUIRED_MEMORY_LANES = Object.freeze(['application-owned', 'harness-owned', 'agent-owned']);
const REQUIRED_BENCHMARK_REFERENCES = Object.freeze(['SWE-bench', 'Terminal-Bench', 'inspect_ai']);

export function evaluateHarnessRadarGate(radar) {
  const failures = [];
  if (radar?.schemaVersion !== 1) failures.push('schemaVersion must be 1');
  if (!/best-of-Agent-Harnesses/i.test(String(radar?.source?.url ?? radar?.source?.name ?? ''))) {
    failures.push('source must reference best-of-Agent-Harnesses');
  }
  if (!isDateLike(radar?.source?.starsCapturedAt)) {
    failures.push('source.starsCapturedAt must be recorded');
  }

  const autonomy = axisById(radar, 'autonomy');
  const recovery = axisById(radar, 'recovery');
  const adoption = axisById(radar, 'adoption-surface');
  if (
    !axisHasTiers(autonomy, REQUIRED_AUTONOMY_TIERS) ||
    !tierAtLeast(autonomy?.minimum, autonomy?.tiers, 'bounded') ||
    autonomy?.target !== 'headless'
  ) {
    failures.push('autonomy axis must target headless with bounded minimum');
  }
  if (
    !axisHasTiers(recovery, REQUIRED_RECOVERY_TIERS) ||
    !tierAtLeast(recovery?.minimum, recovery?.tiers, 'resumable') ||
    recovery?.target !== 'durable'
  ) {
    failures.push('recovery axis must target durable with resumable minimum');
  }
  if (
    !axisHasTiers(adoption, REQUIRED_ADOPTION_TIERS) ||
    !/lowest|least|smallest|minimal/i.test(String(adoption?.principle ?? ''))
  ) {
    failures.push('adoption-surface axis must preserve lowest-surface principle');
  }

  const terminalHarnessPattern = patternById(radar, 'terminal-agent-shell-vs-harness');
  if (!textMatches(terminalHarnessPattern, /\bTUI\b/i) || !textMatches(terminalHarnessPattern, /\bharness\b/i)) {
    failures.push('missing terminal-agent-shell-vs-harness pattern');
  }

  const toolDiscoveryPattern = patternById(radar, 'tool-discovery-context-budget');
  if (
    !textMatches(toolDiscoveryPattern, /\bMCP\b|\btool discovery\b|\btool-discovery\b/i) ||
    !textMatches(toolDiscoveryPattern, /\btoken\b/i)
  ) {
    failures.push('missing tool-discovery-context-budget pattern');
  }

  const memoryPattern = patternById(radar, 'memory-ownership-lanes');
  const lanes = Array.isArray(memoryPattern?.lanes) ? memoryPattern.lanes : [];
  const missingLanes = REQUIRED_MEMORY_LANES.filter((lane) => !lanes.includes(lane));
  if (missingLanes.length > 0) {
    failures.push(`memory-ownership-lanes missing lanes: ${missingLanes.join(', ')}`);
  }

  const benchmarkPattern = patternById(radar, 'benchmark-eval-mix');
  const references = Array.isArray(benchmarkPattern?.references) ? benchmarkPattern.references : [];
  const missingBenchmarks = REQUIRED_BENCHMARK_REFERENCES.filter(
    (reference) => !references.some((candidate) => String(candidate).toLowerCase() === reference.toLowerCase()),
  );
  if (missingBenchmarks.length > 0) {
    failures.push(`benchmark-eval-mix missing references: ${missingBenchmarks.join(', ')}`);
  }

  const refreshPattern = patternById(radar, 'curation-refresh-routine');
  if (!textMatches(refreshPattern, /\brefresh\b|\bregenerate\b|\bweekly\b/i)) {
    failures.push('missing curation-refresh-routine pattern');
  }

  return {
    name: 'harness-radar-alignment',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'Harness radar covers autonomy, recovery, tool discovery, memory ownership, benchmark mix, and refresh discipline.'
        : failures.join('; '),
    observed: {
      source: radar?.source?.name,
      starsCapturedAt: radar?.source?.starsCapturedAt,
      autonomyMinimum: autonomy?.minimum,
      autonomyTarget: autonomy?.target,
      recoveryMinimum: recovery?.minimum,
      recoveryTarget: recovery?.target,
      adoptionPrinciple: adoption?.principle,
      terminalHarnessPattern: terminalHarnessPattern?.id,
      toolDiscoveryPattern: toolDiscoveryPattern?.id,
      memoryLanes: lanes,
      benchmarkReferences: references,
      refreshCadence: refreshPattern?.cadence,
      failures,
    },
  };
}

function axisById(radar, id) {
  return Array.isArray(radar?.axes) ? radar.axes.find((axis) => axis?.id === id) : undefined;
}

function patternById(radar, id) {
  return Array.isArray(radar?.patterns)
    ? radar.patterns.find((pattern) => pattern?.id === id)
    : undefined;
}

function axisHasTiers(axis, requiredTiers) {
  return Array.isArray(axis?.tiers) && requiredTiers.every((tier, index) => axis.tiers[index] === tier);
}

function tierAtLeast(value, tiers, minimum) {
  if (!Array.isArray(tiers)) return false;
  const valueIndex = tiers.indexOf(value);
  const minimumIndex = tiers.indexOf(minimum);
  return valueIndex >= minimumIndex && minimumIndex >= 0;
}

function textMatches(value, pattern) {
  return pattern.test(JSON.stringify(value ?? {}));
}

function isDateLike(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
