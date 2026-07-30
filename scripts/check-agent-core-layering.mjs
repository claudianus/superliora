#!/usr/bin/env node
/**
 * Intra-package layering for agent-core.
 *
 * Rules:
 * 1. tools/ must not import agent/session top-level barrels (subpaths OK).
 * 2. services/ must not import loop/.
 * 3. session/ → agent/ imports are allow-listed.
 *
 * Usage:
 *   node scripts/check-agent-core-layering.mjs
 *   node scripts/check-agent-core-layering.mjs --fail
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const srcRoot = join(repoRoot, 'packages/agent-core/src');
const failOnViolation = process.argv.includes('--fail');

/** Existing session → agent importers (frozen). */
const SESSION_TO_AGENT_ALLOWLIST = new Set([
  'session/conversation-loops.ts',
  'session/export/manifest.ts',
  'session/index.ts',
  'session/response-language-llm.ts',
  'session/rpc.ts',
  'session/store/session-store.ts',
  'session/subagent-errors.ts',
  'session/subagent-host.ts',
  'session/subagent-progress-preview.ts',
  'session/subagent-run-lifecycle.ts',
  'session/trace.ts',
  'session/ultra-swarm-debate.ts',
  'session/vision-analyzer/types.ts',
]);

/**
 * Existing tools → agent/session barrel imports (frozen). Prefer subpath imports
 * for new code; shrink this list over time.
 */
const TOOLS_BARREL_ALLOWLIST = new Set([
  'tools/builtin/collaboration/ask-user.ts',
  'tools/builtin/collaboration/search-skill.ts',
  'tools/builtin/collaboration/search-tools.ts',
  'tools/builtin/collaboration/skill-tool.ts',
  'tools/builtin/collaboration/swarm-channel.ts',
  'tools/builtin/collaboration/ultra-swarm.ts',
  'tools/builtin/goal/create-goal.ts',
  'tools/builtin/goal/create-ultra-goal.ts',
  'tools/builtin/goal/get-goal.ts',
  'tools/builtin/goal/set-goal-budget.ts',
  'tools/builtin/goal/update-goal.ts',
  'tools/builtin/planning/enter-plan-mode.ts',
  'tools/builtin/planning/exit-plan-mode.ts',
  'tools/builtin/planning/next-phase.ts',
  'tools/builtin/planning/record-interview-finding.ts',
  'tools/builtin/review/code-review.ts',
  'tools/builtin/state/ultrawork-graph.ts',
]);

/** Known services → loop imports (frozen; shrink over time). */
const SERVICES_LOOP_ALLOWLIST = new Set(['services/message/transcript.ts']);

const IMPORT_SPECIFIER =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_SPECIFIER = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const warnings = [];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      if (entry === 'skill' || entry === 'node_modules' || entry === 'dist') continue;
      files.push(...walk(entryPath));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(entryPath);
    }
  }
  return files;
}

function isBarrelImport(specifier, layer) {
  if (specifier === `#/${layer}`) return true;
  const relativeBarrel = new RegExp(`(?:^|/)(?:\\.\\./)+${layer}$`);
  return relativeBarrel.test(specifier);
}

function resolvesToAgent(specifier, fromFile) {
  if (specifier === '#/agent' || specifier.startsWith('#/agent/')) return true;
  if (!specifier.startsWith('.')) return false;
  const fromDir = dirname(fromFile);
  const resolved = resolve(fromDir, specifier);
  const rel = relative(srcRoot, resolved).replaceAll('\\', '/');
  return rel === 'agent' || rel.startsWith('agent/');
}

function scanFile(absPath) {
  const rel = relative(srcRoot, absPath).replaceAll('\\', '/');
  const underTools = rel.startsWith('tools/');
  const underServices = rel.startsWith('services/');
  const underSession = rel.startsWith('session/');
  if (!underTools && !underServices && !underSession) return;

  const lines = readFileSync(absPath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trimStart().startsWith('//')) continue;
    for (const pattern of [IMPORT_SPECIFIER, DYNAMIC_IMPORT_SPECIFIER]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const specifier = match[1];
        if (underTools) {
          if (isBarrelImport(specifier, 'agent') || isBarrelImport(specifier, 'session')) {
            if (!TOOLS_BARREL_ALLOWLIST.has(rel)) {
              warnings.push(
                `${rel}:${i + 1}: tools/ must not import agent/session barrel ("${specifier}")`,
              );
            }
          }
        }
        if (underServices) {
          if (
            specifier === '#/loop' ||
            specifier.startsWith('#/loop/') ||
            /(?:^|\/)(?:\.\.\/)+loop(?:\/|$)/.test(specifier)
          ) {
            if (!SERVICES_LOOP_ALLOWLIST.has(rel)) {
              warnings.push(`${rel}:${i + 1}: services/ must not import loop/ ("${specifier}")`);
            }
          }
        }
        if (underSession && resolvesToAgent(specifier, absPath)) {
          if (!SESSION_TO_AGENT_ALLOWLIST.has(rel)) {
            warnings.push(
              `${rel}:${i + 1}: session→agent import not on allowlist ("${specifier}")`,
            );
          }
        }
      }
    }
  }
}

for (const file of walk(srcRoot)) {
  scanFile(file);
}

if (warnings.length === 0) {
  console.log('agent-core layering check: no violations.');
  process.exit(0);
}

const header = failOnViolation
  ? 'agent-core layering check FAILED:'
  : 'agent-core layering check WARNINGS (non-blocking):';
console[failOnViolation ? 'error' : 'warn'](header);
for (const warning of warnings) {
  console[failOnViolation ? 'error' : 'warn'](`- ${warning}`);
}
console[failOnViolation ? 'error' : 'warn'](`Total: ${warnings.length}`);
process.exit(failOnViolation ? 1 : 0);
