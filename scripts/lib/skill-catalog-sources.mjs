/**
 * Multi-source skill catalog fetchers and normalizers.
 *
 * Sources:
 * - github.com/anthropics/skills (official Agent Skills examples)
 * - github.com/EricGrill/agent-personalities-skills (universal + claude-code skills)
 * - github.com/luokai0/ai-agent-skills-by-luo-kai (curated domain skills, 4000+)
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { basename, dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const FENCE = '---';

function gitCloneShallow(url, dest, branch = 'main') {
  execSync(`git clone --depth 1 --branch ${branch} ${url} ${dest}`, { stdio: 'inherit' });
}

function normalizeSkillName(name, fallback) {
  const base = (name || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'skill';
}

function parseFrontmatterName(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (match === null) return undefined;
  const nameMatch = match[1].match(/^name:\s*(.+)$/m);
  return nameMatch?.[1]?.trim().replace(/^["']|["']$/g, '');
}

function injectCatalogMetadata(text, catalogSource, catalogId) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match === null) return text;
  let meta = match[1];
  const body = match[2];
  if (!/^catalogSource:/m.test(meta)) meta += `\ncatalogSource: ${catalogSource}`;
  if (!/^catalogId:/m.test(meta)) meta += `\ncatalogId: ${catalogId}`;
  return `${FENCE}\n${meta.trim()}\n${FENCE}\n${body}`;
}

async function walkSkillMdFiles(rootDir) {
  const results = [];
  async function walk(dir, depth = 0) {
    if (depth > 12) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        await walk(full, depth + 1);
      } else if (entry.name === 'SKILL.md') {
        results.push(full);
      }
    }
  }
  await walk(rootDir);
  return results;
}

function shouldSkipPath(skillPath, excludeParts) {
  if (excludeParts.length === 0) return false;
  return excludeParts.some((part) => skillPath.includes(part));
}

async function copySkillTree(skillMdPath, destDir, catalogSource, catalogId) {
  const skillDir = dirname(skillMdPath);
  await mkdir(dirname(destDir), { recursive: true });
  await cp(skillDir, destDir, { recursive: true, force: true });
  const skillMd = join(destDir, 'SKILL.md');
  const text = await readFile(skillMd, 'utf8');
  await writeFile(skillMd, injectCatalogMetadata(text, catalogSource, catalogId), 'utf8');
}

const SOURCE_CONFIGS = [
  {
    key: 'anthropic',
    url: 'https://github.com/anthropics/skills.git',
    branch: 'main',
    prefix: 'anthropic',
    priority: 1,
    skillRoots: ['skills'],
    excludePathParts: [],
  },
  {
    key: 'ericgrill',
    url: 'https://github.com/EricGrill/agent-personalities-skills.git',
    branch: 'master',
    prefix: 'ericgrill',
    priority: 2,
    skillRoots: ['skills/universal', 'skills/claude-code'],
    excludePathParts: [],
  },
  {
    key: 'luokai',
    url: 'https://github.com/luokai0/ai-agent-skills-by-luo-kai.git',
    branch: 'main',
    prefix: 'luokai',
    priority: 3,
    skillRoots: ['ai-agent-skills'],
    excludePathParts: ['21-external-registries', '22-clawhub-skills'],
  },
];

export async function buildSkillCatalog(outDir, options = {}) {
  const includeExternal = options.includeExternal === true;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const byName = new Map();
  const sourceCounts = { anthropic: 0, ericgrill: 0, luokai: 0 };

  for (const config of SOURCE_CONFIGS) {
    const excludeParts = config.key === 'luokai' && !includeExternal
      ? config.excludePathParts
      : config.key === 'luokai' && includeExternal
        ? []
        : config.excludePathParts;

    console.log(`Fetching ${config.key}...`);
    const tempRoot = join(tmpdir(), `superliora-skills-${config.key}-${Date.now()}`);
    gitCloneShallow(config.url, tempRoot, config.branch);
    let scanned = 0;

    try {
      for (const root of config.skillRoots) {
        const scanRoot = join(tempRoot, root);
        try {
          await stat(scanRoot);
        } catch {
          console.warn(`  skip missing root: ${root}`);
          continue;
        }
        const skillFiles = await walkSkillMdFiles(scanRoot);
        for (const skillMdPath of skillFiles) {
          const rel = relative(tempRoot, skillMdPath);
          if (shouldSkipPath(rel, excludeParts)) continue;
          scanned += 1;
          const text = await readFile(skillMdPath, 'utf8');
          const folderName = basename(dirname(skillMdPath));
          const frontmatterName = parseFrontmatterName(text);
          const normalized = normalizeSkillName(frontmatterName, folderName);
          const catalogId = `${config.prefix}-${normalized}`;
          const existing = byName.get(normalized);
          if (existing !== undefined && existing.priority <= config.priority) continue;

          if (existing !== undefined) {
            await rm(join(outDir, existing.catalogId), { recursive: true, force: true });
          }

          const destDir = join(outDir, catalogId);
          await copySkillTree(skillMdPath, destDir, config.key, catalogId);
          byName.set(normalized, {
            catalogId,
            catalogSource: config.key,
            normalizedName: normalized,
            priority: config.priority,
          });
        }
      }
      sourceCounts[config.key] = scanned;
      console.log(`  scanned ${scanned}, catalog now ${byName.size} unique`);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    counts: {
      ...sourceCounts,
      deduped: byName.size,
      written: byName.size,
    },
    sources: {
      anthropic: 'https://github.com/anthropics/skills',
      ericgrill: 'https://github.com/EricGrill/agent-personalities-skills',
      luokai: 'https://github.com/luokai0/ai-agent-skills-by-luo-kai',
    },
  };

  await writeFile(join(outDir, 'catalog-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const ts = `// AUTO-GENERATED by scripts/build-skill-catalog.mjs
// Do not edit manually.
export const SKILL_CATALOG_SOURCE_COUNTS = ${JSON.stringify(manifest.counts, null, 2)} as const;
`;
  await writeFile(join(dirname(outDir), 'catalog-manifest.generated.ts'), ts, 'utf8');

  return manifest;
}
