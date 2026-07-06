import { isSwarmToolResult } from './boundary-compaction';

export interface SwarmExpertMemory {
  readonly expertId: string;
  readonly verdict: string;
  readonly evidenceIds: readonly string[];
  readonly archiveId?: string;
  readonly phase?: string;
}

export interface SwarmRunMemory {
  readonly runId: string;
  readonly experts: readonly SwarmExpertMemory[];
  readonly councilDecision?: string;
  readonly workNodeIds: readonly string[];
}

const EXPERT_BLOCK_RE = /<expert\s+([^>]+)>\n?([\s\S]*?)\n<\/expert>/g;
const ARCHIVE_ID_RE = /\[liora-archived id=([a-f0-9]+)/;
const EVIDENCE_ATTR_RE = /evidence_ids="([^"]*)"/i;
const RUN_ID_RE = /run_id="([^"]+)"/i;

export function extractSwarmRunsFromText(text: string): readonly SwarmRunMemory[] {
  if (!isSwarmToolResult(text)) return [];
  const runId = RUN_ID_RE.exec(text)?.[1] ?? 'unknown-run';
  const experts: SwarmExpertMemory[] = [];
  for (const match of text.matchAll(EXPERT_BLOCK_RE)) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    const expertId = readAttr(attrs, 'expert_id') ?? 'unknown';
    const verdict = readAttr(attrs, 'verdict') ?? 'PASS';
    const phase = readAttr(attrs, 'phase');
    const evidenceFromAttr = readAttr(attrs, 'evidence_ids');
    const evidenceIds = evidenceFromAttr === undefined
      ? []
      : evidenceFromAttr.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
    const archiveId = ARCHIVE_ID_RE.exec(inner)?.[1];
    experts.push({ expertId, verdict, evidenceIds, archiveId, phase });
  }
  if (experts.length === 0) return [];
  const workNodeIds = [...text.matchAll(/work_node_ids="([^"]*)"/gi)]
    .flatMap((match) => (match[1] ?? '').split(',').map((item) => item.trim()))
    .filter((item) => item.length > 0);
  return [{ runId, experts, workNodeIds }];
}

export function extractSwarmRunsFromMessages(
  messages: readonly { readonly content: readonly { readonly type: string; readonly text?: string }[] }[],
): readonly SwarmRunMemory[] {
  const runs: SwarmRunMemory[] = [];
  for (const message of messages) {
    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n');
    if (text.length === 0) continue;
    runs.push(...extractSwarmRunsFromText(text));
  }
  return runs;
}

export function renderSwarmRunsMemorySection(runs: readonly SwarmRunMemory[]): string {
  if (runs.length === 0) return '';
  const lines = ['swarm_runs:'];
  for (const run of runs) {
    lines.push(`- run_id=${run.runId}`);
    for (const expert of run.experts) {
      const evidence = expert.evidenceIds.length > 0 ? expert.evidenceIds.join(',') : 'none';
      const archive = expert.archiveId === undefined ? '' : ` archive_id=${expert.archiveId}`;
      const phase = expert.phase === undefined ? '' : ` phase=${expert.phase}`;
      lines.push(
        `  - expert_id=${expert.expertId} verdict=${expert.verdict} evidence_ids=${evidence}${phase}${archive}`,
      );
    }
    if (run.workNodeIds.length > 0) {
      lines.push(`  work_node_ids=${run.workNodeIds.join(',')}`);
    }
  }
  return lines.join('\n');
}

function readAttr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
  return match?.[1];
}
