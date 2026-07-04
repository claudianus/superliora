export function buildImprovementProposal(report, delta, iteration) {
  const failed = report.taskResults.filter((task) => task.status === 'FAIL');
  const blocked = report.taskResults.filter((task) => task.status === 'BLOCKED');
  const quarantined = report.taskResults.filter((task) => task.status === 'QUARANTINED');
  const recommendations = [];
  if (failed.length > 0) {
    recommendations.push('Fix the highest-weight failed checks first, then rerun seed before holdout.');
  }
  if (blocked.length > 0) {
    recommendations.push('Resolve environment preflight blockers before treating score movement as model quality.');
  }
  if (quarantined.length > 0) {
    recommendations.push('Keep quarantined tasks excluded from score and refresh leaked fixtures before re-enabling.');
  }
  if (recommendations.length === 0) {
    recommendations.push('No score-improving code change proposed; preserve current behavior and expand holdout coverage.');
  }
  const summary = recommendations.join(' ');
  const markdown = [
    '# Bench Improvement Proposal',
    '',
    `Iteration: ${iteration}`,
    `Status: ${report.status}`,
    `Score: ${report.metrics.score}`,
    `Delta: ${delta}`,
    '',
    '## Recommendation',
    '',
    summary,
    '',
    '## Failure Taxonomy',
    '',
    ...Object.entries(report.taxonomy).map(([name, count]) => `- ${name}: ${String(count)}`),
    '',
  ].join('\n');
  return { summary, markdown };
}

export function renderLoopMarkdown(summary) {
  const lines = [
    '# SuperLiora Agent Bench Loop',
    '',
    `Status: **${summary.status}**`,
    `Reason: ${summary.reason}`,
    `Best score: ${summary.bestScore}`,
    `Wall ms: ${summary.wallClockMs}`,
    `Rerun command: ${summary.rerun?.command ?? 'unknown'}`,
    `Evidence root: ${summary.rerun?.evidenceRoot ?? 'unknown'}`,
    '',
    '| iteration | status | score | passRate | scored/selected | q | guard | delta | evidence |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |',
  ];
  for (const iteration of summary.iterations) {
    const counts = iteration.counts ?? {};
    const scope = counts.scored === undefined || counts.selected === undefined
      ? 'unknown'
      : `${counts.scored}/${counts.selected}`;
    const quarantined = counts.quarantined ?? 'unknown';
    const guard = summarizeIterationGuard(iteration);
    lines.push(
      `| ${iteration.index} | ${iteration.status} | ${iteration.score} | ${iteration.passRate} | ${scope} | ${quarantined} | ${guard} | ${iteration.delta} | ${iteration.evidenceRoot} |`,
    );
  }
  const focusLines = summary.iterations.flatMap((iteration) => renderFocusMarkdown(iteration));
  if (focusLines.length > 0) {
    lines.push('', '## Focus', '', ...focusLines);
  }
  lines.push(
    '',
    '## Guardrails',
    '',
    `- bounded: ${summary.guardrails.bounded}`,
    `- maxIterations: ${summary.guardrails.maxIterations}`,
    `- maxTotalMs: ${summary.guardrails.maxTotalMs}`,
    `- executeCodeChanges: ${summary.guardrails.executeCodeChanges}`,
    '',
  );
  return `${lines.join('\n')}\n`;
}

function renderFocusMarkdown(iteration) {
  const task = iteration.focus?.tasks?.[0];
  if (task === undefined) return [];
  const taxonomy = Array.isArray(task.taxonomy) && task.taxonomy.length > 0
    ? task.taxonomy.join(', ')
    : 'unknown';
  return [
    `- iteration ${iteration.index}: ${task.status ?? 'UNKNOWN'} ${task.id ?? 'unknown'} (${taxonomy})`,
    `  - result: ${task.resultPath ?? 'unknown'}`,
  ];
}

function summarizeIterationGuard(iteration) {
  const task = iteration.quarantine?.tasks?.[0];
  if (task === undefined) return 'none';
  const findings = Array.isArray(task.findings) && task.findings.length > 0
    ? task.findings.join(',')
    : 'no_findings';
  return `${task.id}: ${findings}`;
}
