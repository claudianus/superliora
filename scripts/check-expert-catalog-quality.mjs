#!/usr/bin/env node
/**
 * Quality gate for expert personas + meta.
 * Fails if any persona is thin, empty-headed, or meta lacks whenToUse/capabilities.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metaPath = resolve(root, 'packages/agent-core/src/expert-agents/catalog-meta.ts');
const personasPath = resolve(
  root,
  'packages/agent-core/src/expert-agents/catalog-personas.json',
);

const FILLER_RE =
  /\b(seamless|robustly|robust|leverage|delve|cutting[- ]edge|synergy|unlock|game[- ]changer|revolutionize)\b/gi;

function loadMetaArray(src) {
  const start = src.indexOf('export const EXPERT_CATALOG_META');
  const eq = src.indexOf('=', start);
  const arrStart = src.indexOf('[', eq);
  const endMarker = src.indexOf('export const EXPERT_CATALOG_META_BY_ID');
  let slice = src.slice(arrStart, endMarker).trim();
  if (slice.endsWith(';')) slice = slice.slice(0, -1).trim();
  slice = slice.replace(/\s*as const\s*$/, '');
  return JSON.parse(slice);
}

function scorePersona(text) {
  const t = String(text ?? '');
  const headings = (t.match(/^##\s+/gm) || []).length;
  const emptyHeadings = (t.match(/^##[^\n]*\n(?:\s*\n)+(?=##|$)/gm) || []).length;
  const hasIdentity = /You are \*\*|Identity|Your Role/i.test(t);
  const hasRules = /Critical Rules|MUST NOT|Non-negotiable|Anti-pattern/i.test(t);
  const hasDone = /Success Metrics|Definition of Done|Deliverable/i.test(t);
  const filler = (t.match(FILLER_RE) || []).length;
  const score =
    (t.length >= 1500 ? 2 : t.length >= 600 ? 1 : 0) +
    (headings >= 4 ? 2 : headings >= 2 ? 1 : 0) +
    (hasIdentity ? 1 : 0) +
    (hasRules ? 1 : 0) +
    (hasDone ? 1 : 0) +
    (emptyHeadings === 0 ? 1 : 0) -
    (filler > 8 ? 1 : 0) -
    (t.length < 400 ? 2 : 0) -
    (emptyHeadings >= 3 ? 1 : 0);
  return { score, len: t.length, emptyHeadings, hasIdentity, hasRules };
}

const meta = loadMetaArray(readFileSync(metaPath, 'utf8'));
const personas = JSON.parse(readFileSync(personasPath, 'utf8'));
const errors = [];

if (meta.length !== Object.keys(personas).length) {
  errors.push(
    `meta/personas count mismatch: meta=${meta.length} personas=${Object.keys(personas).length}`,
  );
}

for (const entry of meta) {
  const text = personas[entry.id];
  if (text === undefined) {
    errors.push(`missing persona body: ${entry.id}`);
    continue;
  }
  const m = scorePersona(text);
  if (m.len < 800) errors.push(`thin persona (${m.len} chars): ${entry.id}`);
  if (m.score < 5) errors.push(`low score ${m.score}: ${entry.id}`);
  if (m.emptyHeadings >= 2) errors.push(`empty headings: ${entry.id}`);
  if (!entry.whenToUse || entry.whenToUse.length < 12) {
    errors.push(`missing whenToUse: ${entry.id}`);
  }
  if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
    errors.push(`empty capabilities: ${entry.id}`);
  }
  if (!Array.isArray(entry.tags) || entry.tags.length < 2) {
    errors.push(`weak tags: ${entry.id}`);
  }
}

if (errors.length > 0) {
  console.error(`Expert catalog quality gate failed (${errors.length} issues):`);
  for (const e of errors.slice(0, 40)) console.error(`- ${e}`);
  if (errors.length > 40) console.error(`… +${errors.length - 40} more`);
  process.exit(1);
}

console.log(
  `Expert catalog quality gate passed: ${meta.length} experts, personas present, meta fields filled.`,
);
