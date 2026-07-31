#!/usr/bin/env node
/**
 * Inventory legacy Ultra/Liora public-surface branding debt in hot paths.
 *
 * Scans:
 *   - packages/agent-core/src/agent/tool/builtin-tools.ts
 *   - packages/agent-core/src/profile/ (all .yaml)
 *   - apps/liora/src/tui/commands/hub/command-list*.ts
 *
 * Usage:
 *   node scripts/check-branding-debt.mjs          # warn, exit 0
 *   node scripts/check-branding-debt.mjs --fail     # exit 1 when debt found
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const failOnDebt = process.argv.includes('--fail');

const SCAN_FILES = [
  'packages/agent-core/src/agent/tool/builtin-tools.ts',
];

const SCAN_GLOBS = [
  { root: 'packages/agent-core/src/profile', ext: '.yaml' },
  { root: 'apps/liora/src/tui/commands/hub', prefix: 'command-list', ext: '.ts' },
];

/** Legacy public tool names slated for sovereign rename. */
const TOOL_DEBT_NAMES = [
  'LioraRead',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraExpand',
  'LioraReview',
  'CreateUltraGoal',
  'UltraworkGraph',
  'UltraSwarm',
  'AgentSwarm',
];

/**
 * Profile paths that intentionally keep legacy tool names for backwards compatibility.
 * agent.yaml is sovereign-default; full.yaml keeps a minimal legacy compat slice only.
 *
 * Map: profile rel path → legacy tool names allowed in that file.
 */
const PROFILE_TOOL_DEBT_ALLOWLIST = new Map([
  [
    'packages/agent-core/src/profile/default/full.yaml',
    new Set(['CreateUltraGoal', 'UltraworkGraph', 'UltraSwarm', 'AgentSwarm']),
  ],
]);

/**
 * Legacy tools still registered in builtin-tools.ts for explicit/compat use but
 * trimmed from bundled profiles. Sovereign twins (Review, CreateGoal, TaskGraph,
 * Expand, RepoQuery) cover the LLM surface; legacy names remain for replay,
 * SearchTools discovery, and explicit profile selection.
 */
const REGISTRATION_ONLY_TOOL_DEBT = new Set([
  'LioraRead',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraExpand',
  'LioraReview',
  'CreateUltraGoal',
  'UltraworkGraph',
  'UltraSwarm',
  'AgentSwarm',
]);

/**
 * Legacy slash primary names → preferred sovereign primaries.
 * Flags when `name:` is still the legacy value.
 *
 * Advanced compat primaries (`ultragoal`, `ultraplan`) stay registered with
 * `hiddenAliases` — not debt. Sovereign primaries (`mission`, `fleet`) are
 * already migrated in command-list-modes.ts.
 */
const SLASH_DEBT = [
  { legacy: 'ultrawork', preferred: 'mission' },
  { legacy: 'ultraswarm', preferred: 'fleet' },
];

/** Advanced slash commands kept for compat — not primary-name debt. */
const SLASH_DEBT_EXEMPT_PRIMARIES = new Set(['ultragoal', 'ultraplan']);

function walkYamlFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walkYamlFiles(entryPath, out);
    } else if (entry.endsWith('.yaml')) {
      out.push(entryPath);
    }
  }
}

function collectScanPaths() {
  const paths = SCAN_FILES.map((rel) => join(repoRoot, rel));
  for (const { root, ext, prefix } of SCAN_GLOBS) {
    const absRoot = join(repoRoot, root);
    if (prefix) {
      let entries;
      try {
        entries = readdirSync(absRoot);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.startsWith(prefix) && entry.endsWith(ext)) {
          paths.push(join(absRoot, entry));
        }
      }
    } else {
      walkYamlFiles(absRoot, paths);
    }
  }
  return paths;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.codePointAt(i) === 10) line++;
  }
  return line;
}

function isAllowedProfileToolDebt(relPath, toolName) {
  const allowed = PROFILE_TOOL_DEBT_ALLOWLIST.get(relPath);
  return allowed?.has(toolName) ?? false;
}

function isAllowedRegistrationToolDebt(relPath, toolName) {
  return (
    relPath === 'packages/agent-core/src/agent/tool/builtin-tools.ts' &&
    REGISTRATION_ONLY_TOOL_DEBT.has(toolName)
  );
}

function scanToolDebt(relPath, text) {
  const hits = [];
  for (const name of TOOL_DEBT_NAMES) {
    if (isAllowedProfileToolDebt(relPath, name)) continue;
    if (isAllowedRegistrationToolDebt(relPath, name)) continue;
    const re = new RegExp(`\\b${name}\\b`, 'g');
    for (const match of text.matchAll(re)) {
      hits.push({
        kind: 'tool',
        name,
        rel: relPath,
        line: lineNumberAt(text, match.index ?? 0),
        excerpt: text.slice(match.index ?? 0, (match.index ?? 0) + 40).split('\n')[0],
      });
    }
  }
  return hits;
}

function scanSlashDebt(relPath, text) {
  const hits = [];
  for (const { legacy, preferred } of SLASH_DEBT) {
    const re = new RegExp(`\\bname:\\s*['"]${legacy}['"]`, 'g');
    for (const match of text.matchAll(re)) {
      const primary = legacy;
      if (SLASH_DEBT_EXEMPT_PRIMARIES.has(primary)) continue;
      hits.push({
        kind: 'slash',
        name: legacy,
        preferred,
        rel: relPath,
        line: lineNumberAt(text, match.index ?? 0),
        excerpt: text.slice(match.index ?? 0, (match.index ?? 0) + 60).split('\n')[0],
      });
    }
  }
  return hits;
}

const paths = collectScanPaths();
const toolHits = [];
const slashHits = [];

for (const absPath of paths) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    continue;
  }
  const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
  toolHits.push(...scanToolDebt(relPath, text));
  if (relPath.includes('/commands/hub/command-list')) {
    slashHits.push(...scanSlashDebt(relPath, text));
  }
}

const totalDebt = toolHits.length + slashHits.length;

console.log('Branding debt scan (legacy Ultra/Liora public surface)');
console.log(`Scanned ${paths.length} file(s)`);

if (totalDebt === 0) {
  console.log('No branding debt matches in scanned paths.');
  process.exit(0);
}

if (toolHits.length > 0) {
  console.warn(`\nTOOL NAMES (${toolHits.length}):`);
  for (const hit of toolHits) {
    console.warn(`  ${hit.rel}:${hit.line}\t${hit.name}\t${hit.excerpt.trim()}`);
  }
}

if (slashHits.length > 0) {
  console.warn(`\nSLASH PRIMARY NAMES (${slashHits.length}):`);
  for (const hit of slashHits) {
    console.warn(
      `  ${hit.rel}:${hit.line}\t/${hit.name} → prefer /${hit.preferred}\t${hit.excerpt.trim()}`,
    );
  }
}

console.warn(`\nTotal branding debt items: ${totalDebt}`);
if (failOnDebt) {
  process.exit(1);
}
process.exit(0);
