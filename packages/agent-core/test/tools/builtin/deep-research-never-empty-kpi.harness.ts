/**
 * Sovereign Reform W13 — DeepResearch empty-cascade never-empty KPI harness.
 * Deterministic mock attempts (no live network).
 */

import { vi } from 'vitest';

import {
  buildDeepResearchOutput,
  DeepResearchTool,
  type DeepResearchDepth,
} from '#/tools/builtin/web/deep-research';
import { ResearchSearchEngine } from '#/tools/providers/research-search';
import {
  getSearchNeverEmptyTelemetry,
  resetSearchNeverEmptyTelemetry,
  type SearchNeverEmptyTelemetry,
} from '#/tools/providers/search-never-empty-telemetry';
import { executeTool } from '../fixtures/execute-tool';
import { toolContentString } from '../fixtures/fake-kaos';

/** Minimum soft-degrade success rate for empty-cascade attempts. */
export const DEEP_RESEARCH_NEVER_EMPTY_SUCCESS_TARGET = 0.99;

/** Minimum synthetic empty-cascade attempts in the default smoke path. */
export const DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET = 100;

export interface DeepResearchNeverEmptyAttemptStub {
  readonly hardFail: boolean;
  readonly degraded: boolean;
  readonly resultsCount: number;
  readonly output: string;
}

export interface DeepResearchNeverEmptyKpiReport {
  readonly attemptCount: number;
  readonly softDegradeCount: number;
  readonly hardFailCount: number;
  readonly successRate: number;
  readonly meetsSuccessTarget: boolean;
  readonly meetsKpi: boolean;
  readonly detail: string;
  readonly telemetry: SearchNeverEmptyTelemetry;
}

/** Required markers on DeepResearch empty-cascade soft-degrade output. */
export function outputHasDeepResearchNeverEmptyMarkers(output: string): boolean {
  return (
    output.includes('offline_stub:') &&
    output.includes('degraded: true') &&
    output.includes('next:') &&
    /\bCh4\b/.test(output) &&
    /\bCh5\b/.test(output) &&
    output.includes('do_not: halt')
  );
}

/** Single empty-cascade attempt with offline stub + never-empty footer (green path). */
export function fakeDeepResearchEmptyCascadeAttempt(
  question = 'empty cascade topic',
): DeepResearchNeverEmptyAttemptStub {
  const output = buildDeepResearchOutput({
    question,
    queries: [question, `${question} overview`],
    sources: [],
    degraded: true,
    hops: 2,
    channelsTried: ['ch1', 'ch3'],
    allowBrowser: false,
  });
  return {
    hardFail: false,
    degraded: true,
    resultsCount: 0,
    output,
  };
}

/** Turn-killing hard fail — counts against the hard-fail 0 target. */
export function fakeDeepResearchHardFailAttempt(): DeepResearchNeverEmptyAttemptStub {
  return { hardFail: true, degraded: false, resultsCount: 0, output: '' };
}

/** Degraded empty output missing offline_stub — not a usable never-empty soft degrade. */
export function fakeDeepResearchMissingOfflineStubAttempt(): DeepResearchNeverEmptyAttemptStub {
  return {
    hardFail: false,
    degraded: true,
    resultsCount: 0,
    output: [
      'degraded: true',
      'channelsTried: ch1',
      'next: try browser automation (Ch4) or Chrome extension bridge (Ch5)',
    ].join('\n'),
  };
}

function isSoftDegradeSuccess(attempt: DeepResearchNeverEmptyAttemptStub): boolean {
  if (attempt.hardFail) {
    return false;
  }
  if (attempt.resultsCount > 0) {
    return true;
  }
  if (!attempt.degraded) {
    return false;
  }
  if (attempt.output.length === 0) {
    return false;
  }
  return outputHasDeepResearchNeverEmptyMarkers(attempt.output);
}

/** Grade synthetic empty-cascade attempts — soft-degrade rate + hard-fail count vs targets. */
export function gradeDeepResearchNeverEmptyKpi(
  attempts: readonly DeepResearchNeverEmptyAttemptStub[],
): DeepResearchNeverEmptyKpiReport {
  if (attempts.length === 0) {
    return {
      attemptCount: 0,
      softDegradeCount: 0,
      hardFailCount: 0,
      successRate: 0,
      meetsSuccessTarget: false,
      meetsKpi: false,
      detail: 'no attempts',
      telemetry: { hardFailCount: 0, softDegradeCount: 0 },
    };
  }

  let softDegradeCount = 0;
  let hardFailCount = 0;
  for (const attempt of attempts) {
    if (attempt.hardFail) {
      hardFailCount += 1;
      continue;
    }
    if (isSoftDegradeSuccess(attempt)) {
      softDegradeCount += 1;
    }
  }

  const attemptCount = attempts.length;
  const successRate = softDegradeCount / attemptCount;
  const meetsSuccessTarget = successRate >= DEEP_RESEARCH_NEVER_EMPTY_SUCCESS_TARGET;
  const meetsKpi =
    hardFailCount === 0 &&
    meetsSuccessTarget &&
    attemptCount >= DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET;

  const pct = Math.round(successRate * 100);
  const detail = meetsKpi
    ? `${String(attemptCount)} attempts · soft ${String(pct)}% · hard-fail 0 — targets met`
    : hardFailCount > 0
      ? `${String(hardFailCount)} hard-fail(s) — requires hard-fail 0`
      : meetsSuccessTarget
        ? `soft ${String(pct)}% ok; need ≥${String(DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET)} attempts`
        : `soft ${String(pct)}% below ≥${String(Math.round(DEEP_RESEARCH_NEVER_EMPTY_SUCCESS_TARGET * 100))}% target`;

  return {
    attemptCount,
    softDegradeCount,
    hardFailCount,
    successRate,
    meetsSuccessTarget,
    meetsKpi,
    detail,
    telemetry: { hardFailCount, softDegradeCount },
  };
}

/**
 * Simulate N empty-cascade attempts with fake outcomes. Default: 100 all-soft (smoke path).
 * Optional hardFailAtAttempt or missOfflineStubAtAttempt inject a single streak break.
 */
export function runDeepResearchNeverEmptyKpi(
  attemptCount: number = DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET,
  options?: {
    readonly hardFailAtAttempt?: number;
    readonly missOfflineStubAtAttempt?: number;
  },
): DeepResearchNeverEmptyKpiReport {
  const attempts: DeepResearchNeverEmptyAttemptStub[] = [];
  const hardFailAtAttempt = options?.hardFailAtAttempt;
  const missOfflineStubAtAttempt = options?.missOfflineStubAtAttempt;

  for (let i = 0; i < attemptCount; i++) {
    const attemptIndex = i + 1;
    if (hardFailAtAttempt === attemptIndex) {
      attempts.push(fakeDeepResearchHardFailAttempt());
    } else if (missOfflineStubAtAttempt === attemptIndex) {
      attempts.push(fakeDeepResearchMissingOfflineStubAttempt());
    } else {
      attempts.push(fakeDeepResearchEmptyCascadeAttempt(`topic-${String(attemptIndex)}`));
    }
  }

  return gradeDeepResearchNeverEmptyKpi(attempts);
}

/** Run default smoke KPI and sync counters through process-wide never-empty telemetry. */
export function runDeepResearchNeverEmptyKpiWithTelemetry(
  attemptCount: number = DEEP_RESEARCH_NEVER_EMPTY_ATTEMPT_TARGET,
): DeepResearchNeverEmptyKpiReport {
  resetSearchNeverEmptyTelemetry();
  const report = runDeepResearchNeverEmptyKpi(attemptCount);
  resetSearchNeverEmptyTelemetry();
  for (let i = 0; i < report.softDegradeCount; i++) {
    buildDeepResearchOutput({
      question: 'telemetry sync',
      queries: ['telemetry sync'],
      sources: [],
      degraded: true,
      hops: 1,
      channelsTried: ['ch3'],
    });
  }
  const telemetry = getSearchNeverEmptyTelemetry();
  return {
    ...report,
    telemetry,
  };
}

/** One-line KPI summary for script / CI logs. */
export function formatDeepResearchNeverEmptyKpiReport(
  report: DeepResearchNeverEmptyKpiReport,
): string {
  const pct = (report.successRate * 100).toFixed(1);
  return (
    `deep-research-never-empty-kpi: attempts=${String(report.attemptCount)} ` +
    `soft=${String(report.softDegradeCount)}/${String(report.attemptCount)} (${pct}% ≥${String(DEEP_RESEARCH_NEVER_EMPTY_SUCCESS_TARGET * 100)}%) ` +
    `hard-fail=${String(report.hardFailCount)} ` +
    `meetsKpi=${String(report.meetsKpi)} ` +
    `telemetry=${JSON.stringify(report.telemetry)}`
  );
}

/** Build a mock engine where every channel returns empty (no network). */
export function buildEmptyCascadeResearchEngine(options?: {
  readonly allowBrowserChannel?: boolean;
}): ResearchSearchEngine {
  const allowBrowserChannel = options?.allowBrowserChannel ?? false;
  const browserSearch = vi
    .fn<() => Promise<Array<{ title: string; url: string; snippet: string }>>>()
    .mockResolvedValue([]);
  const chromeSearch = vi
    .fn<() => Promise<Array<{ title: string; url: string; snippet: string }>>>()
    .mockResolvedValue([]);
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

  return new ResearchSearchEngine({
    fetchImpl,
    browserChannel: allowBrowserChannel
      ? { available: () => true, search: browserSearch }
      : undefined,
    chromeExtensionChannel: allowBrowserChannel
      ? { available: () => true, search: chromeSearch }
      : undefined,
    search: {
      strategy: 'fallback',
      freeFallback: false,
      providers: [{ kind: 'brave', apiKey: 'brave-test-key' }],
    },
  });
}

/** Execute one live DeepResearchTool empty-cascade attempt via mocked engine (no network). */
export async function runDeepResearchEmptyCascadeToolAttempt(options?: {
  readonly question?: string;
  readonly depth?: DeepResearchDepth;
  readonly allowBrowser?: boolean;
}): Promise<{ readonly isError: boolean; readonly output: string }> {
  process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'] = '1';
  try {
    const engine = buildEmptyCascadeResearchEngine({
      allowBrowserChannel: options?.allowBrowser === true,
    });
    const tool = new DeepResearchTool(engine);
    const result = await executeTool(tool, {
      turnId: 'kpi-turn',
      toolCallId: 'kpi-call',
      args: {
        question: options?.question ?? 'empty cascade deep research',
        depth: options?.depth ?? 'standard',
        ...(options?.allowBrowser === undefined
          ? {}
          : { allow_browser: options.allowBrowser }),
      },
      signal: new AbortController().signal,
    });
    return { isError: result.isError ?? false, output: toolContentString(result) };
  } finally {
    delete process.env['SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK'];
  }
}
