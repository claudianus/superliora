import type { MemorySearchResult, MemoryStats } from '@superliora/sdk';

import { loadBenchStatus, redactBenchStatusText, type BenchStatus } from './bench';
import type { SlashCommandHost } from './dispatch';
import { requestTUILayoutRender } from '../utils/frame-render';
import {
  loadMemoryReadinessEvidence,
  type MemoryReadinessSnapshot,
} from './evidence-readiness';
import { loadPreflightHumanWriting } from './preflight-human-writing';
import { buildPreflightLines as renderPreflightLines } from './preflight-lines';
import { loadPreflightLoopRun } from './preflight-loop';
import {
  buildPreflightRefreshPlan,
  defaultPreflightHumanWriting,
  evidenceFreshnessSignal,
  isBenchReady,
  isMemoryReady,
  isRecallReady,
  nextPreflightAction,
} from './preflight-readiness';
import { loadPreflightRefreshRun } from './preflight-refresh';
import {
  DEFAULT_PREFLIGHT_RECALL_QUERY,
  PREFLIGHT_FRESHNESS_WINDOW_MS,
  type PreflightArgs,
  type PreflightFreshness,
  type PreflightHumanWriting,
  type PreflightLoopRun,
  type PreflightRefreshRun,
  type PreflightStatus,
} from './preflight-types';
import { formatPreflightError } from './preflight-utils';
import { redactMemoryReadinessText } from './memory';

export type {
  PreflightFreshness,
  PreflightFreshnessSignal,
  PreflightHumanWriting,
  PreflightLoopRun,
  PreflightRefreshBench,
  PreflightRefreshGates,
  PreflightRefreshPlan,
  PreflightRefreshRun,
  PreflightRuntimeCandidate,
  PreflightStatus,
} from './preflight-types';

export { loadPreflightHumanWriting } from './preflight-human-writing';
export { loadPreflightLoopRun } from './preflight-loop';
export { loadPreflightRefreshRun } from './preflight-refresh';

export async function handlePreflightCommand(host: SlashCommandHost, rawArgs: string): Promise<void> {
  const { UsagePanelComponent } = await import('../components/messages/usage-panel');
  const status = await loadPreflightStatus(host, rawArgs);
  const panel = new UsagePanelComponent(() => buildPreflightLines(status), 'primary', ' Preflight ');
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

export async function loadPreflightStatus(
  host: SlashCommandHost,
  rawArgs: string,
): Promise<PreflightStatus> {
  const args = parsePreflightArgs(rawArgs);
  const bench = loadBenchStatus(host.state.appState.workDir, args.benchArgs);
  const statsResult = await loadPreflightMemoryStats(host);
  const searchResult = await loadPreflightMemorySearch(host, args.query);
  return buildPreflightStatus({
    bench,
    memory: {
      stats: 'stats' in statsResult ? statsResult.stats : undefined,
      statsError: 'error' in statsResult ? statsResult.error : undefined,
      query: args.query,
      searchResults: searchResult.results,
      searchError: searchResult.error,
      evidence: loadMemoryReadinessEvidence(host.state.appState.workDir),
    },
    refreshRun: loadPreflightRefreshRun(host.state.appState.workDir),
    loopRun: loadPreflightLoopRun(host.state.appState.workDir),
    humanWriting: loadPreflightHumanWriting(host.state.appState.workDir),
  });
}

export function buildPreflightStatus(input: {
  readonly bench: BenchStatus;
  readonly memory: MemoryReadinessSnapshot;
  readonly freshness?: PreflightFreshness;
  readonly humanWriting?: PreflightHumanWriting;
  readonly refreshRun?: PreflightRefreshRun;
  readonly loopRun?: PreflightLoopRun;
  readonly nowMs?: number;
  readonly freshnessWindowMs?: number;
}): PreflightStatus {
  const freshness = input.freshness ?? buildPreflightFreshness({
    bench: input.bench,
    memory: input.memory,
    nowMs: input.nowMs ?? Date.now(),
    windowMs: input.freshnessWindowMs ?? PREFLIGHT_FRESHNESS_WINDOW_MS,
  });
  const nextAction = nextPreflightAction(input.bench, input.memory, freshness);
  const refreshPlan = buildPreflightRefreshPlan(input.bench, input.memory, freshness);
  const humanWriting = input.humanWriting ?? defaultPreflightHumanWriting();
  return {
    bench: input.bench,
    memory: input.memory,
    freshness,
    humanWriting,
    refreshPlan,
    refreshRun: input.refreshRun,
    loopRun: input.loopRun,
    ready: isBenchReady(input.bench)
      && isMemoryReady(input.memory)
      && isRecallReady(input.memory)
      && input.memory.evidence.llmWiki.verified
      && input.memory.evidence.knowledgeMap.verified
      && input.memory.evidence.browserUse.ready
      && input.memory.evidence.computerUse.ready
      && freshness.ready
      && humanWriting.ready,
    nextAction: humanWriting.ready ? nextAction : humanWriting.nextAction,
  };
}

export function buildPreflightFreshness(input: {
  readonly bench: BenchStatus;
  readonly memory: MemoryReadinessSnapshot;
  readonly nowMs?: number;
  readonly windowMs?: number;
}): PreflightFreshness {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = input.windowMs ?? PREFLIGHT_FRESHNESS_WINDOW_MS;
  const freshness = {
    windowMs,
    bench: evidenceFreshnessSignal(input.bench.sourcePath, nowMs, windowMs),
    llmWiki: evidenceFreshnessSignal(input.memory.evidence.llmWiki.sourcePath, nowMs, windowMs),
    knowledgeMap: evidenceFreshnessSignal(input.memory.evidence.knowledgeMap.sourcePath, nowMs, windowMs),
    browserUse: evidenceFreshnessSignal(input.memory.evidence.browserUse.sourcePath, nowMs, windowMs),
    computerUse: evidenceFreshnessSignal(input.memory.evidence.computerUse.sourcePath, nowMs, windowMs),
  };
  return {
    ...freshness,
    ready: freshness.bench.state === 'fresh'
      && freshness.llmWiki.state === 'fresh'
      && freshness.knowledgeMap.state === 'fresh'
      && freshness.browserUse.state === 'fresh'
      && freshness.computerUse.state === 'fresh',
  };
}

export function buildPreflightLines(status: PreflightStatus): string[] {
  return renderPreflightLines(status, redactPreflightText);
}

export function redactPreflightText(text: string): string {
  return redactMemoryReadinessText(redactBenchStatusText(text))
    .replaceAll('[[REDACTED_ENV]]', '[REDACTED_SECRET]');
}

function parsePreflightArgs(rawArgs: string): PreflightArgs {
  const args = rawArgs.trim();
  if (args.length === 0) {
    return { benchArgs: '', query: DEFAULT_PREFLIGHT_RECALL_QUERY };
  }

  const queryIndex = args.indexOf('--query=');
  if (queryIndex >= 0) {
    return {
      benchArgs: args.slice(0, queryIndex).trim(),
      query: args.slice(queryIndex + '--query='.length).trim() || DEFAULT_PREFLIGHT_RECALL_QUERY,
    };
  }

  return { benchArgs: args, query: DEFAULT_PREFLIGHT_RECALL_QUERY };
}

async function loadPreflightMemoryStats(
  host: SlashCommandHost,
): Promise<{ readonly stats: MemoryStats } | { readonly error: string }> {
  try {
    return { stats: await host.harness.memory.stats() };
  } catch (error) {
    return { error: formatPreflightError(error) };
  }
}

async function loadPreflightMemorySearch(
  host: SlashCommandHost,
  query: string,
): Promise<{ readonly results?: readonly MemorySearchResult[]; readonly error?: string }> {
  if (query.length === 0) return {};
  try {
    const results = host.session === undefined
      ? await host.harness.memory.search({ query, limit: 3 })
      : await host.session.recall(query, { limit: 3 });
    return { results };
  } catch (error) {
    return { error: formatPreflightError(error) };
  }
}
