import { join } from 'node:path';

import type { CandidateStatus } from './bench-types';
import { formatBoolean } from './bench-format';
import { displaySourcePath, quoteBenchShellArg } from './bench-path';
import { asBoolean, asNumber, asRecord, asString, timestampOf } from './bench-parse';

export function normalizeReplaySummary(workDir: string, path: string, record: Record<string, unknown>): CandidateStatus {
  const replayed = asRecord(record['replayedLoopSummary']) ?? asRecord(record['loopSummary']);
  const iterationValues = Array.isArray(replayed?.['iterations']) ? replayed['iterations'] : [];
  const iterations = iterationValues.flatMap((item) => {
    const iteration = asRecord(item);
    return iteration === null ? [] : [iteration];
  });
  const lastIteration = iterations.at(-1);
  const childExit = asNumber(record['childExitCode']);
  const childSignal = asString(record['childSignal']);
  const childTimedOut = asBoolean(record['childTimedOut']);
  const onlyEvidenceRootChanged = asBoolean(record['onlyEvidenceRootChanged']);
  const shellParsing = asBoolean(record['shellParsing']);
  const exit = childExit === undefined ? childSignal ?? 'unknown' : String(childExit);
  const childStatus = asString(replayed?.['status']) ?? 'UNKNOWN';
  const replayStatus = asString(record['status']) ?? 'UNKNOWN';
  const sourceSummaryPath = asString(record['sourceSummaryPath']);
  const evidenceRoot = asString(record['evidenceRoot']);
  const replaySource = sourceSummaryPath === undefined ? undefined : displaySourcePath(workDir, sourceSummaryPath);
  const replayEvidence = evidenceRoot === undefined ? undefined : displaySourcePath(workDir, evidenceRoot);
  const replayVerdict = replayVerdictLine({
    wrapperStatus: replayStatus,
    childStatus,
    childExit,
    childSignal,
    childTimedOut,
    onlyEvidenceRootChanged,
    shellParsing,
  });

  return {
    sourcePath: path,
    status: replayStatus,
    score: asNumber(replayed?.['bestScore']) ?? asNumber(lastIteration?.['score']),
    passRate: asNumber(lastIteration?.['passRate']),
    replaySummary: [
      `child ${childStatus}`,
      `exit ${exit}`,
      `rootOnly ${formatBoolean(onlyEvidenceRootChanged)}`,
      `shellParsing ${formatBoolean(shellParsing)}`,
      `timeout ${formatBoolean(childTimedOut)}`,
    ].join('; '),
    replayVerdict,
    replaySource,
    replayEvidence,
    replayInspect: replayEvidence === undefined ? undefined : `cat ${quoteBenchShellArg(join(replayEvidence, 'loop-summary.json'))}`,
    replayLog: replayEvidence === undefined ? undefined : `cat ${quoteBenchShellArg(join(replayEvidence, 'commands.jsonl'))}`,
    replayDiff: replayDiffCommand(replaySource, replayEvidence),
    holdout: 'loop replay wrapper',
    providerBlock: 'not applicable',
    redaction: 'not recorded',
    noSecret: true,
    nextAction: replayNextAction(replayVerdict, childStatus),
    warnings: [],
    timestamp: timestampOf(record, path),
  };
}

export function replayDiffCommand(replaySource: string | undefined, replayEvidence: string | undefined): string | undefined {
  if (replaySource === undefined || replayEvidence === undefined) return undefined;
  return `diff -u ${quoteBenchShellArg(replaySource)} ${quoteBenchShellArg(join(replayEvidence, 'loop-summary.json'))}`;
}

export function replayNextAction(replayVerdict: string, childStatus: string): string {
  if (replayVerdict.startsWith('trusted;')) {
    return `Replay verified; inspect child loop result ${childStatus} before the next improvement.`;
  }
  return 'Inspect replay-summary.json and commands.jsonl before trusting this replay result.';
}

interface ReplayVerdictInput {
  readonly wrapperStatus: string;
  readonly childStatus: string;
  readonly childExit?: number;
  readonly childSignal?: string;
  readonly childTimedOut?: boolean;
  readonly onlyEvidenceRootChanged?: boolean;
  readonly shellParsing?: boolean;
}

function replayVerdictLine(input: ReplayVerdictInput): string {
  const trusted = input.wrapperStatus === 'PASS'
    && input.childStatus === 'PASS'
    && input.childExit === 0
    && input.childSignal === undefined
    && input.childTimedOut === false
    && input.onlyEvidenceRootChanged === true
    && input.shellParsing === false;
  if (trusted) {
    return 'trusted; child PASS; exit 0; rootOnly true; shellParsing false; timeout false';
  }

  const blockers: string[] = [];
  const concerns: string[] = [];
  if (input.wrapperStatus === 'BLOCKED' || input.wrapperStatus === 'FAIL') blockers.push(`wrapper ${input.wrapperStatus}`);
  else if (input.wrapperStatus !== 'PASS') concerns.push(`wrapper ${input.wrapperStatus}`);
  if (input.childStatus === 'BLOCKED' || input.childStatus === 'FAIL') blockers.push(`child ${input.childStatus}`);
  else if (input.childStatus !== 'PASS') concerns.push(`child ${input.childStatus}`);
  if (input.childSignal !== undefined) blockers.push(`signal ${input.childSignal}`);
  if (input.childExit === undefined) concerns.push('exit unknown');
  else if (input.childExit !== 0) blockers.push(`exit ${input.childExit}`);
  if (input.childTimedOut === true) blockers.push('timeout true');
  else if (input.childTimedOut === undefined) concerns.push('timeout unknown');
  if (input.onlyEvidenceRootChanged !== true) concerns.push(`rootOnly ${formatBoolean(input.onlyEvidenceRootChanged)}`);
  if (input.shellParsing !== false) concerns.push(`shellParsing ${formatBoolean(input.shellParsing)}`);

  const verdict = blockers.length > 0 ? 'blocked' : 'suspect';
  return `${verdict}; ${[...blockers, ...concerns].join('; ')}`;
}
