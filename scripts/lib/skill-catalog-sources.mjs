/**
 * Multi-source skill catalog fetchers and normalizers.
 *
 * Sources:
 * - github.com/anthropics/skills (official Agent Skills examples)
 * - github.com/EricGrill/agent-personalities-skills (universal + claude-code skills)
 * - github.com/luokai0/ai-agent-skills-by-luo-kai (curated domain skills, 4000+)
 * - github.com/sickn33/agentic-awesome-skills (community skill library, 1900+)
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
    excludePathParts: [],
  },
  {
    key: 'agentic',
    url: 'https://github.com/sickn33/agentic-awesome-skills.git',
    branch: 'main',
    prefix: 'agentic',
    priority: 4,
    skillRoots: ['skills'],
    excludePathParts: [],
  },
  {
    key: 'claudeskills',
    url: 'https://github.com/alirezarezvani/claude-skills.git',
    branch: 'main',
    prefix: 'claudeskills',
    priority: 5,
    skillRoots: ['.'],
    excludePathParts: ['.claude-plugin', '.codex-plugin', '.github', 'scripts', 'templates', 'docs', 'assets'],
  },
  {
    key: 'mindrally',
    url: 'https://github.com/Mindrally/skills.git',
    branch: 'main',
    prefix: 'mindrally',
    priority: 6,
    skillRoots: ['.'],
    excludePathParts: ['.gitignore', 'LICENSE', 'README.md'],
  },
  {
    key: 'seb1n',
    url: 'https://github.com/seb1n/awesome-ai-agent-skills.git',
    branch: 'main',
    prefix: 'seb1n',
    priority: 7,
    skillRoots: ['.'],
    excludePathParts: ['.gitignore', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'SKILL_TEMPLATE.md', 'test.txt'],
  },
];

export async function buildSkillCatalog(outDir, options = {}) {
  const _includeExternal = options.includeExternal === true;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const byName = new Map();
  const sourceCounts = { anthropic: 0, ericgrill: 0, luokai: 0, agentic: 0, claudeskills: 0, mindrally: 0, seb1n: 0 };

  for (const config of SOURCE_CONFIGS) {
    const excludeParts = config.excludePathParts;

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
      agentic: 'https://github.com/sickn33/agentic-awesome-skills',
      claudeskills: 'https://github.com/alirezarezvani/claude-skills',
      mindrally: 'https://github.com/Mindrally/skills',
      seb1n: 'https://github.com/seb1n/awesome-ai-agent-skills',
    },
  };

  await writeFile(join(outDir, 'catalog-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const ts = `// AUTO-GENERATED by scripts/build-skill-catalog.mjs
// Do not edit manually.
export const SKILL_CATALOG_SOURCE_COUNTS = ${JSON.stringify(manifest.counts, null, 2)} as const;
`;
  
  await writeFile(join(dirname(outDir), 'catalog-manifest.generated.ts'), ts, 'utf8');
  await writeCatalogSearchIndex(outDir);

  return manifest;
}


async function writeCatalogSearchIndex(outDir) {
  const { createHash } = await import('node:crypto');
  const { load } = await import('js-yaml');
  const entries = await readdir(outDir, { withFileTypes: true });
  const skills = [];
  let failed = 0;
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(outDir, entry.name, 'SKILL.md');
    try {
      const text = await readFile(skillMd, 'utf8');
      const parsed = parseFrontmatterLocal(text, load);
      const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
      const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : entry.name;
      const description =
        typeof data.description === 'string' ? data.description.trim() : '';
      const contentHash = createHash('sha256').update(parsed.body).digest('hex');
      skills.push({
        relDir: entry.name,
        name,
        description,
        type: typeof data.type === 'string' ? data.type : undefined,
        whenToUse:
          typeof data.whenToUse === 'string'
            ? data.whenToUse
            : typeof data['when-to-use'] === 'string'
              ? data['when-to-use']
              : undefined,
        disableModelInvocation:
          data.disableModelInvocation === true || data['disable-model-invocation'] === true
            ? true
            : undefined,
        isSubSkill: data.isSubSkill === true || data['is-sub-skill'] === true ? true : undefined,
        category: typeof data.category === 'string' ? data.category : undefined,
        risk: typeof data.risk === 'string' ? data.risk : undefined,
        catalogSource: typeof data.catalogSource === 'string' ? data.catalogSource : undefined,
        catalogId: typeof data.catalogId === 'string' ? data.catalogId : undefined,
        contentHash,
      });
    } catch {
      failed += 1;
    }
  }
  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    skillCount: skills.length,
    failed,
    skills,
  };
  const outPath = join(dirname(outDir), 'catalog-search-index.json');
  await writeFile(outPath, JSON.stringify(payload), 'utf8');
  console.log(`Wrote ${outPath} (${skills.length} skills, ${failed} failed)`);
}

function parseFrontmatterLocal(text, loadYaml) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: null, body: text };
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close === -1) return { data: null, body: text };
  const yamlText = lines.slice(1, close).join('\n').trim();
  const body = lines.slice(close + 1).join('\n');
  try {
    return { data: yamlText ? loadYaml(yamlText) : {}, body };
  } catch {
    return { data: {}, body };
  }
}
