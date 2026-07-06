/**
 * Multi-source expert persona fetchers and normalizers.
 *
 * Sources (MIT or open catalogs):
 * - github.com/msitarzewski/agency-agents
 * - github.com/jee599/agentcrow (builtin YAML agents)
 * - github.com/VoltAgent/awesome-claude-code-subagents
 * - github.com/EricGrill/agent-personalities-skills
 */

export const DIVISION_META = {
  academic: { label: 'Academic', icon: 'GraduationCap', color: '#8B5CF6' },
  design: { label: 'Design', icon: 'PenTool', color: '#EC4899' },
  engineering: { label: 'Engineering', icon: 'Code', color: '#3B82F6' },
  finance: { label: 'Finance', icon: 'DollarSign', color: '#22C55E' },
  'game-development': { label: 'Game Development', icon: 'Gamepad2', color: '#A855F7' },
  gis: { label: 'GIS', icon: 'Map', color: '#14B8A6' },
  healthcare: { label: 'Healthcare', icon: 'HeartPulse', color: '#F43F5E' },
  marketing: { label: 'Marketing', icon: 'Megaphone', color: '#F97316' },
  'paid-media': { label: 'Paid Media', icon: 'Target', color: '#EAB308' },
  product: { label: 'Product', icon: 'Box', color: '#D946EF' },
  'project-management': { label: 'Project Management', icon: 'ClipboardList', color: '#0EA5E9' },
  sales: { label: 'Sales', icon: 'TrendingUp', color: '#10B981' },
  security: { label: 'Security', icon: 'ShieldCheck', color: '#EF4444' },
  'spatial-computing': { label: 'Spatial Computing', icon: 'Boxes', color: '#06B6D4' },
  specialized: { label: 'Specialized', icon: 'Sparkles', color: '#6366F1' },
  support: { label: 'Support', icon: 'LifeBuoy', color: '#84CC16' },
  testing: { label: 'Testing', icon: 'FlaskConical', color: '#F59E0B' },
};

const AGENCY_DIVISIONS = [
  'academic', 'design', 'engineering', 'finance', 'game-development',
  'gis', 'healthcare', 'marketing', 'paid-media', 'product', 'project-management',
  'sales', 'security', 'spatial-computing', 'specialized', 'support', 'testing',
];

const VOLTAGENT_CATEGORY_DIVISION = {
  '01-core-development': 'engineering',
  '02-language-specialists': 'engineering',
  '03-infrastructure': 'engineering',
  '04-quality-security': 'testing',
  '05-data-ai': 'specialized',
  '06-developer-experience': 'engineering',
  '07-specialized-domains': 'specialized',
  '08-business-product': 'product',
  '09-meta-orchestration': 'project-management',
  '10-research-analysis': 'academic',
};

const AGENTCROW_DIVISION = {
  'ai-engineer': 'engineering',
  'backend-architect': 'engineering',
  'frontend-developer': 'engineering',
  'devops-automator': 'engineering',
  'refactoring-specialist': 'engineering',
  'complexity-critic': 'engineering',
  'data-pipeline-engineer': 'engineering',
  'qa-engineer': 'testing',
  'security-auditor-deep': 'security',
  'ui-designer': 'design',
  'technical-writer': 'support',
  'translator': 'specialized',
  'compose-meta-reviewer': 'project-management',
  'unreal-gas-specialist': 'game-development',
  'korean-tech-writer': 'support',
};

const CAPABILITY_SECTIONS = [
  'Core Mission',
  'Core Capabilities',
  'Critical Rules',
  'Specialized',
  'Tools',
  'Frameworks',
];

const WHEN_TO_USE_SECTIONS = ['When to Use', 'When To Use', 'When To Engage'];

export async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'superliora-expert-catalog-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'superliora-expert-catalog-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: match[2].trim() };
}

export function extractSection(body, title) {
  const pattern = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
  const match = pattern.exec(body);
  if (match === null) return '';
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextHeading = rest.search(/^##\s+/m);
  const section = nextHeading < 0 ? rest : rest.slice(0, nextHeading);
  return section.replace(/^>\s?/gm, '').trim();
}

function extractCapabilities(body) {
  const caps = [];
  for (const sectionTitle of CAPABILITY_SECTIONS) {
    const section = extractSection(body, sectionTitle);
    if (section.length === 0) continue;
    for (const line of section.split('\n')) {
      const bullet = line.match(/^[-*]\s*(.+)$/);
      if (bullet) caps.push(bullet[1].trim());
    }
  }
  return caps.slice(0, 10);
}

function extractWhenToUse(meta, body) {
  if (meta.whenToUse?.trim()) return meta.whenToUse.trim();
  if (meta.when_to_use?.trim()) return meta.when_to_use.trim();
  for (const title of WHEN_TO_USE_SECTIONS) {
    const section = extractSection(body, title);
    if (section.length > 0) return section.split('\n')[0]?.trim() ?? section;
  }
  return '';
}

function buildTags(division, name, description, extra = []) {
  return [
    division,
    ...name.toLowerCase().split(/[\s/]+/),
    ...description.toLowerCase().split(/\s+/),
    ...extra.map((tag) => tag.toLowerCase()),
  ]
    .filter((value, index, array) => array.indexOf(value) === index && value.length > 2)
    .slice(0, 12);
}

function titleCaseFromSlug(slug) {
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function divisionMeta(division) {
  return DIVISION_META[division] ?? { label: titleCaseFromSlug(division), icon: 'Circle', color: '#666666' };
}

export function makeExpertEntry({
  id,
  name,
  division,
  description,
  color,
  emoji = '',
  vibe = '',
  tags = [],
  capabilities = [],
  whenToUse = '',
  personaText,
}) {
  const divMeta = divisionMeta(division);
  return {
    id,
    name,
    division,
    divisionLabel: divMeta.label,
    divisionIcon: divMeta.icon,
    divisionColor: divMeta.color,
    description,
    color: color ?? divMeta.color,
    emoji,
    vibe,
    tags: tags.slice(0, 12),
    capabilities: capabilities.slice(0, 10),
    whenToUse,
    personaText: personaText.trim(),
  };
}

function yamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*"(.*?)"\\s*$`, 'm'));
  if (match) return match[1];
  const plain = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return plain?.[1]?.trim() ?? '';
}

function yamlBlock(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*\\|\\n([\\s\\S]*?)(?=^[a-zA-Z_][a-zA-Z0-9_-]*:|$)`, 'm'));
  return match?.[1]?.replace(/^ {4}/gm, '').trim() ?? '';
}

function yamlStringList(text, section, key) {
  const sectionMatch = text.match(new RegExp(`^${section}:\\n([\\s\\S]*?)(?=^[a-zA-Z_][a-zA-Z0-9_-]*:|$)`, 'm'));
  if (!sectionMatch) return [];
  const block = sectionMatch[1];
  const keyMatch = block.match(new RegExp(`^\\s+${key}:\\n([\\s\\S]*?)(?=^\\s+\\w|$)`, 'm'));
  if (!keyMatch) return [];
  return keyMatch[1]
    .split('\n')
    .map((line) => line.match(/^\s+-\s+"(.*)"\s*$/)?.[1] ?? line.match(/^\s+-\s+(.*)$/)?.[1])
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function yamlTopList(text, key) {
  const match = text.match(new RegExp(`^${key}:\\n([\\s\\S]*?)(?=^[a-zA-Z_][a-zA-Z0-9_-]*:|$)`, 'm'));
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.match(/^\s+-\s+"(.*)"\s*$/)?.[1] ?? line.match(/^\s+-\s+(.*)$/)?.[1])
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function yamlTagList(text) {
  const match = text.match(/^tags:\s*\[(.*?)\]\s*$/m);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
    .filter((tag) => tag.length > 0);
}

function agentCrowPersonaText(yamlText, name) {
  const personality = yamlBlock(yamlText, 'personality');
  const communication = yamlBlock(yamlText, 'communication');
  const thinking = yamlBlock(yamlText, 'thinking');
  const must = yamlStringList(yamlText, 'critical_rules', 'must');
  const mustNot = yamlStringList(yamlText, 'critical_rules', 'must_not');
  const deliverables = yamlTopList(yamlText, 'deliverables');
  const successMetrics = yamlTopList(yamlText, 'success_metrics');

  return [
    `# ${name}`,
    '',
    '## Identity',
    personality,
    '',
    '## Communication Style',
    communication,
    '',
    '## Thinking Process',
    thinking,
    '',
    '## Critical Rules — MUST',
    ...must.map((rule) => `- ${rule}`),
    '',
    '## Critical Rules — MUST NOT',
    ...mustNot.map((rule) => `- ${rule}`),
    '',
    '## Deliverables',
    ...deliverables.map((item) => `- ${item}`),
    '',
    '## Success Metrics',
    ...successMetrics.map((item) => `- ${item}`),
  ].join('\n');
}

export async function fetchAgencyAgentsExperts() {
  const experts = [];
  for (const division of AGENCY_DIVISIONS) {
    console.log(`  agency-agents/${division}...`);
    const files = await fetchJson(
      `https://api.github.com/repos/msitarzewski/agency-agents/contents/${division}?ref=main`,
    );
    for (const file of files.filter((entry) => entry.name.endsWith('.md'))) {
      const text = await fetchText(file.download_url);
      const { meta, body } = parseFrontmatter(text);
      const id = file.name.replace(/\.md$/, '');
      const name = meta.name || titleCaseFromSlug(id.split('-').slice(1).join('-'));
      experts.push(makeExpertEntry({
        id,
        name,
        division,
        description: meta.description || '',
        color: meta.color,
        emoji: meta.emoji || '',
        vibe: meta.vibe || '',
        tags: buildTags(division, name, meta.description || '', meta.tags?.split?.(',') ?? []),
        capabilities: extractCapabilities(body),
        whenToUse: extractWhenToUse(meta, body),
        personaText: body,
      }));
    }
  }
  return experts;
}

export async function fetchAgentCrowExperts() {
  const experts = [];
  const files = await fetchJson(
    'https://api.github.com/repos/jee599/agentcrow/contents/agents/builtin/en?ref=main',
  );
  for (const file of files.filter((entry) => entry.name.endsWith('.yaml'))) {
    const slug = file.name.replace(/\.yaml$/, '');
    const yamlText = await fetchText(file.download_url);
    const name = yamlScalar(yamlText, 'name') || titleCaseFromSlug(slug);
    const description = yamlScalar(yamlText, 'description') || `${name} specialist with enforced MUST/MUST NOT rules.`;
    const division = AGENTCROW_DIVISION[slug] ?? 'specialized';
    const must = yamlStringList(yamlText, 'critical_rules', 'must');
    const personaText = agentCrowPersonaText(yamlText, name);
    experts.push(makeExpertEntry({
      id: `agentcrow-${slug}`,
      name,
      division,
      description,
      emoji: '🐦',
      vibe: must[0] ?? 'Hook-enforced specialist with explicit behavioral constraints.',
      tags: buildTags(division, name, description, yamlTagList(yamlText)),
      capabilities: must.slice(0, 10),
      whenToUse: description,
      personaText,
    }));
  }
  return experts;
}

export async function fetchVoltAgentExperts(agencySlugSet) {
  const experts = [];
  const tree = await fetchJson(
    'https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/git/trees/main?recursive=1',
  );
  const files = tree.tree.filter(
    (entry) => entry.path.startsWith('categories/') && entry.path.endsWith('.md') && !entry.path.endsWith('/README.md'),
  );
  console.log(`  voltagent subagents: ${files.length} files`);
  for (const file of files) {
    const parts = file.path.split('/');
    const category = parts[1] ?? 'specialized';
    const slug = parts[2]?.replace(/\.md$/, '') ?? 'unknown';
    if (agencySlugSet.has(slug)) {
      console.log(`    skip duplicate slug: ${slug}`);
      continue;
    }
    const text = await fetchText(`https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/main/${file.path}`);
    const { meta, body } = parseFrontmatter(text);
    const division = VOLTAGENT_CATEGORY_DIVISION[category] ?? 'specialized';
    const name = titleCaseFromSlug(meta.name || slug);
    const description = meta.description || `${name} Claude Code subagent.`;
    experts.push(makeExpertEntry({
      id: `volt-${category}-${slug}`,
      name,
      division,
      description,
      emoji: '⚡',
      vibe: extractSection(body, 'When invoked') || description,
      tags: buildTags(division, name, description, [category, slug]),
      capabilities: extractCapabilities(body),
      whenToUse: meta.description || description,
      personaText: body.length > 0 ? body : text.trim(),
    }));
  }
  return experts;
}

async function listEricGrillMarkdownFiles(dir) {
  const entries = await fetchJson(
    `https://api.github.com/repos/EricGrill/agent-personalities-skills/contents/${dir}?ref=master`,
  );
  const files = [];
  for (const entry of entries) {
    if (entry.type === 'file' && entry.name.endsWith('.md') && entry.name !== 'README.md') {
      if (entry.name === 'personality.md') continue;
      files.push({ path: `${dir}/${entry.name}`, name: entry.name });
    }
    if (entry.type === 'dir') {
      const nested = await listEricGrillMarkdownFiles(`${dir}/${entry.name}`);
      files.push(...nested);
    }
  }
  return files;
}

function ericGrillExpertId(filePath) {
  const relative = filePath.replace(/^personalities\//, '');
  const slug = relative
    .replace(/\.md$/, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `ericgrill-${slug}`;
}

function parseEricGrillPersona(text, filename) {
  const slug = filename.replace(/\.md$/, '');
  const titleMatch = text.match(/^#\s+(.+?)\s*$/m);
  const name = titleMatch?.[1]?.replace(/[^\w\s-]/g, '').trim() || titleCaseFromSlug(slug);
  const description = extractSection(text, 'Description') || `${name} personality.`;
  const promptBlock = text.match(/## System Prompt\n```(?:\w*\n)?([\s\S]*?)```/);
  const personaText = promptBlock?.[1]?.trim() || text.trim();
  return { slug, name, description, personaText };
}

export async function fetchEricGrillExperts(agencySlugSet) {
  const experts = [];
  const roots = ['personalities/general', 'personalities/claude-code'];
  const files = [];
  for (const root of roots) {
    files.push(...await listEricGrillMarkdownFiles(root));
  }
  console.log(`  ericgrill personalities: ${files.length} files`);
  for (const file of files) {
    const text = await fetchText(`https://raw.githubusercontent.com/EricGrill/agent-personalities-skills/master/${file.path}`);
    const parsed = parseEricGrillPersona(text, file.name);
    if (agencySlugSet.has(parsed.slug)) {
      console.log(`    skip duplicate slug: ${parsed.slug}`);
      continue;
    }
    const division = inferEricGrillDivision(parsed.slug, parsed.description);
    experts.push(makeExpertEntry({
      id: ericGrillExpertId(file.path),
      name: parsed.name,
      division,
      description: parsed.description,
      emoji: '✨',
      vibe: parsed.description.split('.')[0] ?? parsed.description,
      tags: buildTags(division, parsed.name, parsed.description, [parsed.slug]),
      capabilities: extractCapabilities(text),
      whenToUse: parsed.description,
      personaText: parsed.personaText,
    }));
  }
  return experts;
}

function inferEricGrillDivision(slug, description) {
  const haystack = `${slug} ${description}`.toLowerCase();
  if (/security|sentinel|vuln/.test(haystack)) return 'security';
  if (/test|qa|debug/.test(haystack)) return 'testing';
  if (/devops|sre|incident|observability|cloud|deploy/.test(haystack)) return 'engineering';
  if (/product|offer|business|youtube|viral/.test(haystack)) return 'product';
  if (/prompt|documentation|writer|narrator/.test(haystack)) return 'support';
  if (/ux|frontend|mobile|design/.test(haystack)) return 'design';
  if (/api|architect|refactor|code|database|ml|data|performance/.test(haystack)) return 'engineering';
  if (/research|academic/.test(haystack)) return 'academic';
  return 'specialized';
}

export function buildAgencySlugSet(experts) {
  const slugs = new Set();
  for (const expert of experts) {
    const parts = expert.id.split('-');
    if (parts.length >= 2) {
      slugs.add(parts.slice(1).join('-'));
    }
  }
  return slugs;
}

export async function fetchAllExpertSources() {
  console.log('Fetching agency-agents...');
  const agency = await fetchAgencyAgentsExperts();
  const agencySlugSet = buildAgencySlugSet(agency);

  console.log('Fetching agentcrow builtin agents...');
  const agentcrow = await fetchAgentCrowExperts();

  console.log('Fetching VoltAgent awesome-claude-code-subagents...');
  const voltagent = await fetchVoltAgentExperts(agencySlugSet);

  console.log('Fetching EricGrill agent-personalities-skills...');
  const ericgrill = await fetchEricGrillExperts(agencySlugSet);

  const byId = new Map();
  for (const expert of [...agency, ...agentcrow, ...voltagent, ...ericgrill]) {
    if (byId.has(expert.id)) {
      console.warn(`  duplicate id skipped: ${expert.id}`);
      continue;
    }
    byId.set(expert.id, expert);
  }

  const experts = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    experts,
    counts: {
      agency: agency.length,
      agentcrow: agentcrow.length,
      voltagent: voltagent.length,
      ericgrill: ericgrill.length,
      total: experts.length,
    },
  };
}
