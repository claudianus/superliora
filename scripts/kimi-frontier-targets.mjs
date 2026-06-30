const REQUIRED_FRONTIER_TARGET_IDS = Object.freeze([
  'swe-bench-pro',
  'terminal-bench-2-1',
  'hle-no-tools',
  'hle-with-tools',
  'osworld-verified',
  'gdpval-aa-v2',
]);

export function evaluateFrontierTargetGate(criteria) {
  const frontierTargets = criteria.frontierBenchmarkTargets ?? criteria.frontierTargets;
  const targets = Array.isArray(frontierTargets?.targets) ? frontierTargets.targets : [];
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const failures = [];
  if (frontierTargets === undefined) failures.push('criteria.frontierBenchmarkTargets is missing');
  if (!/\bClaude Sonnet 5\b/i.test(String(frontierTargets?.model ?? ''))) {
    failures.push(`frontier model is ${String(frontierTargets?.model)}`);
  }
  if (!hasOfficialAnthropicSource(frontierTargets?.source)) {
    failures.push('frontier target source is not an official Anthropic URL');
  }
  for (const id of REQUIRED_FRONTIER_TARGET_IDS) {
    const target = targetById.get(id);
    if (target === undefined) {
      failures.push(`missing target ${id}`);
    } else if (!Number.isFinite(target.target) || target.target <= 0) {
      failures.push(`target ${id} has invalid value ${String(target.target)}`);
    }
  }
  return {
    name: 'frontier-benchmark-targets',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    required: true,
    reason:
      failures.length === 0
        ? 'Claude Sonnet 5 frontier benchmark targets are present and source-backed.'
        : failures.join('; '),
    observed: {
      source: normalizeSource(frontierTargets?.source),
      model: frontierTargets?.model,
      scope: frontierTargets?.scope,
      targetCount: targets.length,
      requiredTargetIds: REQUIRED_FRONTIER_TARGET_IDS,
      targets: targets.map(normalizeTarget),
      adoptionPrinciples: Array.isArray(frontierTargets?.adoptionPrinciples)
        ? frontierTargets.adoptionPrinciples
        : [],
    },
  };
}

export function frontierTargetMarkdownLines(observed) {
  const lines = [
    `- model: ${String(observed?.model ?? 'unavailable')}`,
    `- source: ${String(observed?.source?.name ?? 'unavailable')}`,
  ];
  const sourceUrl = observed?.source?.systemCardUrl ?? observed?.source?.url;
  if (sourceUrl !== undefined) lines.push(`- source URL: ${sourceUrl}`);
  if (observed?.source?.notes !== undefined) lines.push(`- note: ${observed.source.notes}`);
  if (observed?.scope !== undefined) lines.push(`- scope: ${observed.scope}`);
  lines.push('', '| Domain | Benchmark | Target | Metric |', '| --- | --- | ---: | --- |');
  const targets = Array.isArray(observed?.targets) ? observed.targets : [];
  for (const target of targets) {
    lines.push(
      `| ${target.domain} | ${target.name} | ${formatTargetValue(target)} | ${target.metric} |`,
    );
  }
  const adoptionPrinciples = Array.isArray(observed?.adoptionPrinciples)
    ? observed.adoptionPrinciples
    : [];
  if (adoptionPrinciples.length > 0) {
    lines.push('', 'Adoption rules:');
    for (const principle of adoptionPrinciples) lines.push(`- ${principle}`);
  }
  return lines;
}

function hasOfficialAnthropicSource(source) {
  const urls = [
    source?.url,
    source?.announcementUrl,
    source?.systemCardUrl,
    source?.systemCardPdfUrl,
  ]
    .filter((value) => typeof value === 'string')
    .map((value) => parseUrl(value))
    .filter((url) => url !== undefined);
  return urls.some((url) =>
    ['www.anthropic.com', 'anthropic.com', 'www-cdn.anthropic.com'].includes(url.hostname),
  );
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function normalizeSource(source) {
  if (source === undefined) return {};
  return {
    name: source.name,
    url: source.url,
    announcementUrl: source.announcementUrl,
    systemCardUrl: source.systemCardUrl,
    systemCardPdfUrl: source.systemCardPdfUrl,
    retrievedAt: source.retrievedAt,
    verificationStatus: source.verificationStatus,
    notes: source.notes,
  };
}

function normalizeTarget(target) {
  return {
    id: target.id,
    domain: target.domain,
    name: target.name,
    metric: target.metric,
    unit: target.unit,
    target: target.target,
    setting: target.setting,
    evaluationMode: target.evaluationMode,
    systemCardTextValue: target.systemCardTextValue,
    note: target.note,
  };
}

function formatTargetValue(target) {
  if (target.unit === 'percent') return `${String(target.target)}%`;
  if (target.unit === undefined) return String(target.target);
  return `${String(target.target)} ${target.unit}`;
}
