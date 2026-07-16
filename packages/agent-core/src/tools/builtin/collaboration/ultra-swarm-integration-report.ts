import { collapseForHandoff } from '../../../agent/compaction/handoff-collapse';

const INTEGRATION_SECTION_MAX_CHARS = 360;
const INTEGRATION_OPEN_GAPS_MAX_CHARS = 900;

export interface UltraSwarmHandoffDigest {
  readonly summary?: string;
  readonly findings?: string;
  readonly recommendations?: string;
  readonly risksAndGaps?: string;
  readonly verification?: string;
}

export interface UltraSwarmIntegrationReportInput {
  readonly spec: {
    readonly expertId: string;
    readonly expertName: string;
    readonly emoji: string;
    readonly phase: string;
    readonly focus: string;
    readonly coverageLane?: string;
    readonly division?: string;
    readonly workNodeIds: readonly string[];
  };
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly verdict: string;
  readonly evidenceIds: readonly string[];
  readonly result?: string;
  readonly error?: string;
}

const HANDOFF_SECTIONS: ReadonlyArray<{
  readonly key: keyof UltraSwarmHandoffDigest;
  readonly pattern: RegExp;
}> = [
  { key: 'summary', pattern: /^##\s*Summary\s*$/im },
  { key: 'findings', pattern: /^##\s*Findings\s*$/im },
  { key: 'recommendations', pattern: /^##\s*Recommendations\s*$/im },
  { key: 'risksAndGaps', pattern: /^##\s*Risks(?:\s*&\s*Gaps)?\s*$/im },
  { key: 'verification', pattern: /^##\s*Verification\s*$/im },
];

export function extractHandoffDigest(body: string): UltraSwarmHandoffDigest {
  const trimmed = body.trim();
  if (trimmed.length === 0) return {};

  const digest: {
    summary?: string;
    findings?: string;
    recommendations?: string;
    risksAndGaps?: string;
    verification?: string;
  } = {};
  for (const section of HANDOFF_SECTIONS) {
    const value = extractMarkdownSection(trimmed, section.pattern);
    if (value !== undefined) {
      digest[section.key] = collapseForHandoff(value, INTEGRATION_SECTION_MAX_CHARS);
    }
  }

  if (digest.summary === undefined) {
    const fallback = stripHandoffNoise(trimmed);
    if (fallback.length > 0) {
      digest.summary = collapseForHandoff(fallback, INTEGRATION_SECTION_MAX_CHARS);
    }
  }

  return digest;
}

export function buildUltraSwarmIntegrationReportXml(
  rendered: readonly UltraSwarmIntegrationReportInput[],
  runId: string,
): string {
  const completed = rendered.filter((entry) => entry.status === 'completed').length;
  const failed = rendered.filter((entry) => entry.status === 'failed').length;
  const aborted = rendered.filter((entry) => entry.status === 'aborted').length;
  const blocked = rendered.filter((entry) => entry.verdict === 'BLOCKED').length;
  const pass = rendered.filter((entry) => entry.verdict === 'PASS').length;
  const failVerdict = rendered.filter((entry) => entry.verdict === 'FAIL').length;

  const lines = [
    `<integration_report run_id="${escapeXml(runId)}">`,
    `<overview completed="${String(completed)}" failed="${String(failed)}" aborted="${String(aborted)}" pass="${String(pass)}" blocked="${String(blocked)}" fail_verdict="${String(failVerdict)}"/>`,
    `<headline>${escapeXml(buildHeadline(completed, failed, aborted, pass, blocked, failVerdict))}</headline>`,
  ];

  const openGaps: string[] = [];
  for (const entry of rendered) {
    const body =
      entry.status === 'completed'
        ? (entry.result ?? '')
        : (entry.error ?? 'unknown error');
    const digest = extractHandoffDigest(body);
    const coverageLane = entry.spec.coverageLane === undefined
      ? ''
      : ` coverage_lane="${escapeXml(entry.spec.coverageLane)}"`;
    const division = entry.spec.division === undefined
      ? ''
      : ` division="${escapeXml(entry.spec.division)}"`;
    const workNodeIds = entry.spec.workNodeIds.length === 0
      ? ''
      : ` work_node_ids="${escapeXml(entry.spec.workNodeIds.join(','))}"`;
    const evidenceIds = entry.evidenceIds.length === 0
      ? ''
      : ` evidence_ids="${escapeXml(entry.evidenceIds.join(','))}"`;

    lines.push(
      `<agent expert_id="${escapeXml(entry.spec.expertId)}" name="${escapeXml(entry.spec.expertName)}" emoji="${escapeXml(entry.spec.emoji)}" phase="${escapeXml(entry.spec.phase)}" focus="${escapeXml(entry.spec.focus)}" outcome="${entry.status}" verdict="${escapeXml(entry.verdict)}"${coverageLane}${division}${workNodeIds}${evidenceIds}>`,
    );
    appendDigestXml(lines, digest);
    lines.push('</agent>');

    if (entry.verdict === 'BLOCKED' || entry.verdict === 'FAIL' || entry.status === 'failed') {
      const gapLine = digest.risksAndGaps ?? digest.summary ?? body;
      openGaps.push(
        `${entry.spec.expertName} (${entry.spec.phase}): ${collapseForHandoff(gapLine, 240)}`,
      );
    } else if (digest.risksAndGaps !== undefined && digest.risksAndGaps.length > 0) {
      openGaps.push(`${entry.spec.expertName}: ${digest.risksAndGaps}`);
    }
  }

  if (openGaps.length > 0) {
    lines.push(
      `<open_gaps>${escapeXml(collapseForHandoff(openGaps.join('\n'), INTEGRATION_OPEN_GAPS_MAX_CHARS))}</open_gaps>`,
    );
  }

  lines.push('</integration_report>');
  return lines.join('\n');
}

function buildHeadline(
  completed: number,
  failed: number,
  aborted: number,
  pass: number,
  blocked: number,
  failVerdict: number,
): string {
  const parts = [`${String(completed)} completed`];
  if (failed > 0) parts.push(`${String(failed)} failed`);
  if (aborted > 0) parts.push(`${String(aborted)} aborted`);
  const verdictParts: string[] = [];
  if (pass > 0) verdictParts.push(`${String(pass)} PASS`);
  if (blocked > 0) verdictParts.push(`${String(blocked)} BLOCKED`);
  if (failVerdict > 0) verdictParts.push(`${String(failVerdict)} FAIL`);
  if (verdictParts.length > 0) parts.push(verdictParts.join(', '));
  return parts.join(' · ');
}

function appendDigestXml(lines: string[], digest: UltraSwarmHandoffDigest): void {
  appendOptionalXml(lines, 'summary', digest.summary);
  appendOptionalXml(lines, 'findings', digest.findings);
  appendOptionalXml(lines, 'recommendations', digest.recommendations);
  appendOptionalXml(lines, 'risks_and_gaps', digest.risksAndGaps);
  appendOptionalXml(lines, 'verification', digest.verification);
}

function appendOptionalXml(lines: string[], tag: string, value: string | undefined): void {
  if (value === undefined || value.length === 0) return;
  lines.push(`<${tag}>${escapeXml(value)}</${tag}>`);
}

function extractMarkdownSection(body: string, headerPattern: RegExp): string | undefined {
  const lines = body.split('\n');
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (headerPattern.test(lines[index] ?? '')) {
      start = index + 1;
      break;
    }
  }
  if (start < 0) return undefined;

  const collected: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^##\s+/.test(line)) break;
    collected.push(line);
  }
  const joined = collected.join('\n').trim();
  return joined.length > 0 ? joined : undefined;
}

function stripHandoffNoise(body: string): string {
  return body
    .replaceAll(/<selection_reason>[\s\S]*?<\/selection_reason>\n?/g, '')
    .replaceAll(/\[liora-archived id=[^\]]+\][^\n]*/g, '')
    .replace(/^VERDICT:\s*\w+\s*/im, '')
    .trim();
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
