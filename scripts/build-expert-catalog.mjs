#!/usr/bin/env node
/**
 * Build script: fetches all expert personas from agency-agents repo
 * and generates a TypeScript catalog module.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromAgentCore = createRequire(join(repoRoot, 'packages/agent-core/package.json'));

const REPO = 'msitarzewski/agency-agents';
const BRANCH = 'main';
const DIVISIONS = [
  'academic', 'design', 'engineering', 'finance', 'game-development',
  'gis', 'marketing', 'paid-media', 'product', 'project-management',
  'sales', 'security', 'spatial-computing', 'specialized', 'support', 'testing'
];

const DIVISION_META = {
  academic: { label: 'Academic', icon: 'GraduationCap', color: '#8B5CF6' },
  design: { label: 'Design', icon: 'PenTool', color: '#EC4899' },
  engineering: { label: 'Engineering', icon: 'Code', color: '#3B82F6' },
  finance: { label: 'Finance', icon: 'DollarSign', color: '#22C55E' },
  'game-development': { label: 'Game Development', icon: 'Gamepad2', color: '#A855F7' },
  gis: { label: 'GIS', icon: 'Map', color: '#14B8A6' },
  marketing: { label: 'Marketing', icon: 'Megaphone', color: '#F97316' },
  'paid-media': { label: 'Paid Media', icon: 'Target', color: '#EAB308' },
  product: { label: 'Product', icon: 'Box', color: '#D946EF' },
  'project-management': { label: 'Project Management', icon: 'ClipboardList', color: '#0EA5E9' },
  sales: { label: 'Sales', icon: 'TrendingUp', color: '#10B981' },
  security: { label: 'Security', icon: 'ShieldCheck', color: '#EF4444' },
  'spatial-computing': { label: 'Spatial Computing', icon: 'Boxes', color: '#06B6D4' },
  specialized: { label: 'Specialized', icon: 'Sparkles', color: '#6366F1' },
  support: { label: 'Support', icon: 'LifeBuoy', color: '#84CC16' },
  testing: { label: 'Testing', icon: 'FlaskConical', color: '#F59E0B' }
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'kimi-code-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'kimi-code-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const lines = match[1].split('\n');
  const meta = {};
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: match[2].trim() };
}

async function buildCatalog() {
  const experts = [];
  let total = 0;

  for (const division of DIVISIONS) {
    console.log(`Fetching ${division}...`);
    const files = await fetchJson(
      `https://api.github.com/repos/${REPO}/contents/${division}?ref=${BRANCH}`
    );
    const mdFiles = files.filter(f => f.name.endsWith('.md'));

    for (const file of mdFiles) {
      try {
        const text = await fetchText(file.download_url);
        const { meta, body } = parseFrontmatter(text);
        const id = file.name.replace(/\.md$/, '');
        const divMeta = DIVISION_META[division] || { label: division, icon: 'Circle', color: '#666' };

        // Extract capabilities from body (section headers and tool lists)
        const caps = [];
        const capMatch = body.match(/(?:Core Capabilities|Specialized|Tools|Frameworks)[\s\S]*?(?=\n## |\n# |\n---|$)/i);
        if (capMatch) {
          const lines = capMatch[0].split('\n');
          for (const line of lines) {
            const m = line.match(/^[-*]\s*(.+)$/);
            if (m) caps.push(m[1].trim());
          }
        }

        // Extract tags from name and description
        const tags = [
          division,
          ...(meta.name || '').toLowerCase().split(/[\s/]+/),
          ...(meta.description || '').toLowerCase().split(/\s+/)
        ].filter((v, i, a) => a.indexOf(v) === i && v.length > 2).slice(0, 20);

        experts.push({
          id,
          name: meta.name || id.split('-').slice(1).join(' ').replace(/\b\w/g, c => c.toUpperCase()),
          division,
          divisionLabel: divMeta.label,
          divisionIcon: divMeta.icon,
          divisionColor: divMeta.color,
          description: meta.description || '',
          color: meta.color || divMeta.color,
          emoji: meta.emoji || '',
          vibe: meta.vibe || '',
          tags: tags.slice(0, 10),
          capabilities: caps.slice(0, 10),
          whenToUse: meta.whenToUse || '',
          personaText: body.slice(0, 2000)
        });
        total++;
      } catch (e) {
        console.error(`  Failed: ${file.name} - ${e.message}`);
      }
    }
  }

  // Generate embeddings for all experts
  console.log("Generating embeddings...");
  const { pipeline } = await import(requireFromAgentCore.resolve('@huggingface/transformers'));
  const extractor = await pipeline("feature-extraction", "ibm-granite/granite-embedding-97m-multilingual-r2", { dtype: "fp32" });

  for (const expert of experts) {
    const text = expert.name + ". " + expert.description + ". " + expert.vibe + ". Division: " + expert.division + ". Tags: " + expert.tags.join(", ") + ". Capabilities: " + expert.capabilities.join(", ");
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const out = output;
    expert.embedding = Array.from(out.data ?? out[0]?.data ?? []);
  }
  console.log("Embeddings generated.");

  console.log(`Total experts: ${total}`);

  // Generate TypeScript file
  const ts = `// AUTO-GENERATED by scripts/build-expert-catalog.mjs
// Do not edit manually. Source: github.com/msitarzewski/agency-agents
import type { ExpertCatalogEntry } from './types';

export const EXPERT_CATALOG: readonly ExpertCatalogEntry[] = ${JSON.stringify(experts, null, 2)} as const;

export const EXPERT_CATALOG_BY_ID: Readonly<Record<string, ExpertCatalogEntry>> = Object.fromEntries(
  EXPERT_CATALOG.map(e => [e.id, e])
);

export const EXPERT_DIVISIONS = ${JSON.stringify(DIVISION_META, null, 2)} as const;
`;

  const outDir = join(dirname(new URL(import.meta.url).pathname), '..', 'packages', 'agent-core', 'src', 'expert-agents');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'catalog.ts'), ts, 'utf-8');
  console.log(`Wrote ${outDir}/catalog.ts (${ts.length} bytes)`);
}

buildCatalog().catch(e => { console.error(e); process.exit(1); });
