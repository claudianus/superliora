#!/usr/bin/env node
/* eslint-disable no-console */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WORKSPACE_DIR } from './lib/workspace-paths.mjs';

const DEFAULT_INPUT_URL = 'https://raw.githubusercontent.com/RyanAlberts/best-of-Agent-Harnesses/main/harnesses.json';
const DEFAULT_OUTPUT_PATH = `${WORKSPACE_DIR}/bench/harness-radar.json`;
const TERMINAL_USE_CASE = 'I want a turnkey coding agent today';
const TOOL_DISCOVERY_USE_CASE = 'I want to plug hundreds to thousands of tools without context bloat';
const EVALUATION_USE_CASE = 'I want to evaluate or benchmark agents';
const REQUIRED_BENCHMARK_REFERENCES = Object.freeze(['SWE-bench', 'Terminal-Bench', 'inspect_ai', 'Agent Lightning']);
const WATCHLIST_USE_CASES = Object.freeze([
  { focus: 'terminal coding agent', intent: TERMINAL_USE_CASE, limit: 3 },
  { focus: 'tool discovery', intent: TOOL_DISCOVERY_USE_CASE, limit: 3 },
  { focus: 'evaluation harness', intent: EVALUATION_USE_CASE, limit: 3 },
]);

export function buildHarnessRadarFromBestOf(data, options = {}) {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  const projectById = new Map(projects.map((project) => [String(project.github_id), project]));
  const terminalPicks = useCasePicks(data, TERMINAL_USE_CASE)
    .map((githubId) => projectById.get(githubId))
    .filter(Boolean)
    .slice(0, 5);
  const toolDiscoveryPicks = useCasePicks(data, TOOL_DISCOVERY_USE_CASE)
    .map((githubId) => projectById.get(githubId))
    .filter(Boolean);
  const toolDiscoveryProjects = (toolDiscoveryPicks.length > 0
    ? toolDiscoveryPicks
    : rankedProjects(projects, (project) => tags(project).includes('tool-discovery'))).slice(0, 5);
  const memoryProjects = ['mem0ai/mem0', 'thedotmack/claude-mem', 'letta-ai/letta']
    .map((githubId) => projectById.get(githubId))
    .filter(Boolean);

  const radar = {
    schemaVersion: 1,
    name: 'superliora-harness-radar',
    source: {
      name: String(data?.meta?.name ?? 'best-of-Agent-Harnesses'),
      url: String(data?.meta?.url ?? 'https://github.com/RyanAlberts/best-of-Agent-Harnesses'),
      starsCapturedAt: String(data?.meta?.stars_captured ?? data?.meta?.starsCapturedAt ?? ''),
      refreshedAt: options.refreshedAt ?? isoDate(new Date()),
      refreshScript: 'node scripts/liora-harness-radar-refresh.mjs',
      changeSummary: undefined,
    },
    axes: [
      {
        id: 'autonomy',
        tiers: ['step-gated', 'checkpoint-gated', 'bounded', 'headless'],
        minimum: 'bounded',
        target: 'headless',
        principle: 'Overnight Ultrawork needs bounded-or-better autonomy, with headless as the product target.',
      },
      {
        id: 'recovery',
        tiers: ['none', 'retry', 'resumable', 'durable'],
        minimum: 'resumable',
        target: 'durable',
        principle: 'Long-running agent loops need resumable recovery as the floor and durable checkpoints as the production bar.',
      },
      {
        id: 'adoption-surface',
        tiers: ['super simple', 'mostly simple', 'slightly complex', 'complex'],
        principle: 'Pick the lowest adoption surface that solves the job; internalize patterns before adding external harnesses.',
      },
    ],
    patterns: [
      {
        id: 'terminal-agent-shell-vs-harness',
        takeaway: 'The TUI is the shell; the harness loop, provider wiring, sandboxing, recovery, and extension model carry the product quality.',
        projects: names(terminalPicks),
        superKimiAdoption: 'Keep user-facing Ultrawork simple while making loop/recovery/tool evidence visible in status and gates.',
      },
      {
        id: 'tool-discovery-context-budget',
        takeaway: 'Use MCP tool discovery and retrieval before loading tool schemas so large tool sets do not bloat every turn.',
        projects: names(toolDiscoveryProjects),
        target: {
          defaultToolExposure: 'search-then-load',
          tokenBudgetImpact: 'measured',
        },
        superKimiAdoption: 'Track default exposed tools, schema-token pressure, and on-demand tool retrieval as SOTA gate inputs.',
      },
      {
        id: 'memory-ownership-lanes',
        takeaway: 'Separate application-owned, harness-owned, and agent-owned memory before designing recall UX.',
        lanes: ['application-owned', 'harness-owned', 'agent-owned'],
        projects: names(memoryProjects),
        superKimiAdoption: 'Show memory readiness by lane instead of a single vague memory health label.',
      },
      {
        id: 'benchmark-eval-mix',
        takeaway: 'Measure source edits, terminal/TUI workflows, recovery, memory recall, and tool efficiency with executable traces.',
        references: REQUIRED_BENCHMARK_REFERENCES,
        superKimiAdoption: 'Keep prompt-only scores auxiliary; require live TUI evidence and internal benchmark traces for SOTA claims.',
      },
      {
        id: 'curation-refresh-routine',
        takeaway: 'Regenerate the radar from structured data with allowlisted diffs, freshness checks, and a concise mover report.',
        cadence: 'weekly',
        superKimiAdoption: 'Use a deterministic refresh script before turning external harness trends into Ultrawork product work.',
      },
    ],
    watchlist: buildWatchlist(data, projectById),
  };
  const changeSummary = buildChangeSummary(
    options.previousRadar,
    radar,
    options.previousLabel ?? 'previous radar',
  );
  if (changeSummary !== undefined) {
    radar.source.changeSummary = changeSummary;
  }
  return radar;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const data = await readJsonInput(options.input);
  const previousLabel = options.previous ?? options.output;
  const previousRadar = await readOptionalJson(previousLabel);
  const radar = buildHarnessRadarFromBestOf(data, {
    previousLabel,
    previousRadar,
    refreshedAt: options.refreshedAt,
  });
  const text = `${JSON.stringify(radar, null, 2)}\n`;
  if (options.dryRun) {
    console.log(text);
    return;
  }
  await writeFile(options.output, text, 'utf8');
  console.log(`Harness radar refreshed: ${options.output}`);
  console.log(`stars captured: ${radar.source.starsCapturedAt}`);
  console.log(`terminal projects: ${patternById(radar, 'terminal-agent-shell-vs-harness').projects.join(', ')}`);
  console.log(`tool-discovery projects: ${patternById(radar, 'tool-discovery-context-budget').projects.join(', ')}`);
  console.log(`watchlist projects: ${radar.watchlist.items.map((item) => item.name).join(', ')}`);
  if (radar.source.changeSummary !== undefined) {
    console.log(`project drift: +${radar.source.changeSummary.totalAdded}/-${radar.source.changeSummary.totalRemoved}`);
  }
}

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT_URL,
    output: DEFAULT_OUTPUT_PATH,
    dryRun: false,
    help: false,
    previous: undefined,
    refreshedAt: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--input') {
      index += 1;
      options.input = argv[index];
    } else if (arg === '--output') {
      index += 1;
      options.output = argv[index];
    } else if (arg === '--previous') {
      index += 1;
      options.previous = argv[index];
    } else if (arg === '--refreshed-at') {
      index += 1;
      options.refreshedAt = argv[index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return `Usage: node scripts/liora-harness-radar-refresh.mjs [options]

Options:
  --input <path|url>       best-of-Agent-Harnesses harnesses.json source.
  --output <path>          Output radar path. Default: ${DEFAULT_OUTPUT_PATH}
  --previous <path>        Previous radar for drift summary. Default: output path.
  --refreshed-at <date>    Override refreshedAt date for reproducible tests.
  --dry-run                Print generated radar instead of writing it.
  --help                   Show this help.
`;
}

async function readJsonInput(input) {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Failed to fetch ${input}: ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(path.resolve(input), 'utf8'));
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await readFile(path.resolve(file), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function useCasePicks(data, intent) {
  const useCases = Array.isArray(data?.use_cases) ? data.use_cases : [];
  const match = useCases.find((entry) => entry?.intent === intent);
  return Array.isArray(match?.picks) ? match.picks.map(String) : [];
}

function rankedProjects(projects, predicate) {
  return projects
    .filter(predicate)
    .toSorted((a, b) => Number(b?.stars ?? 0) - Number(a?.stars ?? 0));
}

function tags(project) {
  return Array.isArray(project?.tags) ? project.tags.map(String) : [];
}

function names(projects) {
  return projects.map((project) => String(project.name)).filter((name) => name.length > 0);
}

function buildWatchlist(data, projectById) {
  const items = [];
  const seen = new Set();
  for (const useCase of WATCHLIST_USE_CASES) {
    const picks = useCasePicks(data, useCase.intent)
      .map((githubId) => projectById.get(githubId))
      .filter(Boolean)
      .slice(0, useCase.limit);
    for (const project of picks) {
      const githubId = String(project.github_id);
      const key = `${useCase.focus}:${githubId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(watchlistItem(project, useCase));
    }
  }
  return {
    generatedFrom: 'best-of-Agent-Harnesses use_cases',
    items,
  };
}

function watchlistItem(project, useCase) {
  return {
    focus: useCase.focus,
    intent: useCase.intent,
    name: String(project.name),
    githubId: String(project.github_id),
    category: String(project.category),
    stars: Number(project.stars ?? 0),
    tier: String(project.tier ?? 'unknown'),
    autonomy: String(project.autonomy ?? 'unknown'),
    recovery: String(project.recovery ?? 'unknown'),
    tags: tags(project),
  };
}

function buildChangeSummary(previousRadar, nextRadar, comparedWith) {
  if (!Array.isArray(previousRadar?.patterns)) return undefined;
  const previousPatterns = new Map(previousRadar.patterns.map((pattern) => [String(pattern?.id), pattern]));
  const patterns = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const nextPattern of nextRadar.patterns) {
    const id = String(nextPattern.id);
    const previousPattern = previousPatterns.get(id);
    const previousProjects = patternProjects(previousPattern);
    const nextProjects = patternProjects(nextPattern);
    const added = nextProjects.filter((project) => !previousProjects.includes(project));
    const removed = previousProjects.filter((project) => !nextProjects.includes(project));
    if (added.length === 0 && removed.length === 0) continue;
    totalAdded += added.length;
    totalRemoved += removed.length;
    patterns.push({ id, added, removed });
  }

  return {
    comparedWith,
    totalAdded,
    totalRemoved,
    patterns,
  };
}

function patternProjects(pattern) {
  return Array.isArray(pattern?.projects) ? pattern.projects.map(String) : [];
}

function patternById(radar, id) {
  return radar.patterns.find((pattern) => pattern.id === id);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
