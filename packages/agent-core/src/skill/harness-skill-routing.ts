/**
 * Prefer SuperLiora harness tools / builtin playbooks over catalog skills that
 * install external stacks (Playwright, Tavily, CUA, swarm orchestrators, …).
 */

import type { SkillDefinition, SkillSearchHit } from './types';

export interface HarnessRoutingDomain {
  readonly id: string;
  readonly query: RegExp;
  /** When matched, skip demotion for this domain (e.g. Playwright e2e). */
  readonly carveOut?: RegExp | undefined;
  readonly preferBuiltin: string;
  readonly demote: RegExp;
  readonly demoteNote: string;
}

/** Catalog skill names that collide with harness tools — demote + Skill() warn. */
export const HARNESS_NAME_COLLISIONS: readonly {
  readonly skillName: string;
  readonly harnessHint: string;
}[] = [
  { skillName: 'web-search', harnessHint: 'WebSearch / FetchURL' },
  { skillName: 'context7', harnessHint: 'Context7Resolve → Context7Docs' },
  { skillName: 'oc-browser-use', harnessHint: 'Browser* tools / Skill("browser-use")' },
];

export const HARNESS_ROUTING_DOMAINS: readonly HarnessRoutingDomain[] = [
  {
    id: 'browser',
    query:
      /\b(browser|screenshot|cloakbrowser|camoufox|lightpanda|browser[-_]?use|puppeteer|playwright|web\s*automat|click_ref|Browser(?:Status|Observe|Act|Screenshot|Console)|VerifySurface|headless|chromium|skyvern|browserless|hyperbrowser|browserbase|scrapling)\b/i,
    carveOut:
      /\b(@playwright\/test|playwright\s*(test|e2e|config)|e2e\s*tests?|test\s*runner)\b/i,
    preferBuiltin: 'browser-use',
    demote:
      /\b(playwright|puppeteer|browser-harness|cdp-browser|oc-browser|browser-ladder|super-browser|agent-browser|skyvern|browserless|hyperbrowser|browserbase|scrapling|web-screenshot|cn-web-screenshot|screenshots|npm run setup|chromium\.launch|puppeteer\.launch|playwright install)\b/i,
    demoteNote: 'demoted: prefer Builtin Browser* tools / Skill("browser-use")',
  },
  {
    id: 'research',
    query:
      /\b(web\s*search|search\s*the\s*web|latest\s*(news|docs|release)|library\s*api|Context7|FetchURL|WebSearch|tavily|serpapi|brave\s*search|duckduckgo|firecrawl|perplexity|documentation\s*lookup)\b/i,
    preferBuiltin: 'research-use',
    demote:
      /\b(tavily|serpapi|serper|brave[-_]?search|duckduckgo|ddg[-_]?web|firecrawl|perplexity|web-search-plus|multi-search-engine|exa\b|googlesearch|shikamaru-web-search)\b/i,
    demoteNote: 'demoted: prefer WebSearch / FetchURL / Context7* / Skill("research-use")',
  },
  {
    id: 'computer',
    query:
      /\b(computer[-_]?use|desktop\s*(click|control|automat)|Computer(?:Status|Capture|Act)|cua[-_]?driver|pyautogui|gui\s*automat|screen\s*control)\b/i,
    preferBuiltin: 'computer-use',
    demote:
      /\b(computer-use-agents|pyautogui|desktop-control|nut\.js|openai\s*operator|anthropic\s*computer)\b/i,
    demoteNote: 'demoted: prefer Computer* tools / Skill("computer-use")',
  },
  {
    id: 'git',
    query:
      /\b(git\s*commit|conventional\s*commits?|commit\s*message|changeset|smart[-_]?git)\b/i,
    carveOut: /\b(git\s*hooks?|husky|commitlint\s*config|custom\s*git\s*workflow)\b/i,
    preferBuiltin: 'git-safe',
    demote:
      /\b(smart[-_]?git|git[-_]?automation|auto[-_]?commit|conventional[-_]?commit)\b/i,
    demoteNote: 'demoted: prefer local AGENTS.md git rules / Skill("git-safe")',
  },
  {
    id: 'orchestration',
    query:
      /\b(subagent|multi[-_]?agent|swarm|orchestrat|spawn\s*workers?|JobCreate|Agent\s*tool)\b/i,
    carveOut: /\b(langgraph|crewai|autogen\s*framework|build\s*a\s*swarm\s*product)\b/i,
    preferBuiltin: 'agent-job',
    demote:
      /\b(subagent-driven|agent-swarm|swarm-orchestrat|multi-agent-orchestrat|claude\s*code\s*task)\b/i,
    demoteNote: 'demoted: prefer Agent / Job* tools / Skill("agent-job")',
  },
  {
    id: 'checks',
    query:
      /\b(run\s*(the\s*)?(tests?|typecheck|lint|checks?)|RunProjectChecks|project\s*checks?|ci\s*checks?)\b/i,
    carveOut: /\b(write\s*(e2e|unit)\s*tests?|playwright\s*test|jest\s*config|vitest\s*config)\b/i,
    preferBuiltin: 'project-checks',
    demote: /\b(test[-_]?runner|npm\s*test\s*playbook|jest[-_]?expert|vitest[-_]?expert)\b/i,
    demoteNote: 'demoted: prefer RunProjectChecks / Skill("project-checks")',
  },
];

export function isBlockedSkillRisk(risk: string | undefined): boolean {
  if (risk === undefined) return false;
  const normalized = risk.trim().toLowerCase();
  return normalized === 'high' || normalized === 'critical' || normalized === 'offensive';
}

export function harnessCollisionHint(skillName: string): string | undefined {
  const key = skillName.trim().toLowerCase();
  return HARNESS_NAME_COLLISIONS.find((entry) => entry.skillName === key)?.harnessHint;
}

export function rerankSkillHitsForHarnessRouting(
  query: string,
  hits: readonly SkillSearchHit[],
  builtins: ReadonlyMap<string, SkillDefinition>,
): SkillSearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  let working: SkillSearchHit[] = hits.length > 0 ? [...hits] : [];
  const activeDomains = HARNESS_ROUTING_DOMAINS.filter(
    (domain) => domain.query.test(trimmed) && !(domain.carveOut?.test(trimmed) ?? false),
  );
  if (activeDomains.length === 0) {
    return demoteNameCollisions(working);
  }

  for (const domain of activeDomains) {
    working = applyDomain(trimmed, working, domain, builtins.get(domain.preferBuiltin));
  }
  return demoteNameCollisions(working);
}

/** Back-compat wrapper used by older tests / call sites. */
export function rerankSkillHitsForBrowserRouting(
  query: string,
  hits: readonly SkillSearchHit[],
  builtinBrowserUse?: SkillDefinition | undefined,
): SkillSearchHit[] {
  const builtins = new Map<string, SkillDefinition>();
  if (builtinBrowserUse !== undefined) builtins.set('browser-use', builtinBrowserUse);
  return rerankSkillHitsForHarnessRouting(query, hits, builtins);
}

export function isBrowserAutomationQuery(query: string): boolean {
  return HARNESS_ROUTING_DOMAINS[0]!.query.test(query.trim());
}

export function wantsExplicitPlaywrightE2E(query: string): boolean {
  return HARNESS_ROUTING_DOMAINS[0]!.carveOut?.test(query.trim()) ?? false;
}

export function isExternalBrowserAutomationSkill(skill: {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly source: string;
}): boolean {
  if (skill.source === 'builtin' || skill.source === 'project' || skill.source === 'user') {
    return false;
  }
  const blob = `${skill.name}\n${skill.description}\n${skill.path}`;
  return HARNESS_ROUTING_DOMAINS[0]!.demote.test(blob);
}

function applyDomain(
  query: string,
  hits: readonly SkillSearchHit[],
  domain: HarnessRoutingDomain,
  builtin: SkillDefinition | undefined,
): SkillSearchHit[] {
  const topK = Math.max(hits.length, builtin !== undefined ? 1 : 0);
  if (topK === 0) return [];

  const preferred: SkillSearchHit[] = [];
  const kept: SkillSearchHit[] = [];
  const demoted: SkillSearchHit[] = [];
  let sawBuiltin = false;

  for (const hit of hits) {
    if (hit.source === 'builtin' && hit.name === domain.preferBuiltin) {
      sawBuiltin = true;
      preferred.push({
        ...hit,
        score: Math.max(hit.score, 1) + 50,
        matchReason: appendReason(hit.matchReason, `builtin ${domain.preferBuiltin} preferred`),
      });
      continue;
    }
    if (isExternalForDomain(hit, domain)) {
      demoted.push({
        ...hit,
        score: hit.score * 0.05,
        matchReason: appendReason(hit.matchReason, domain.demoteNote),
      });
      continue;
    }
    kept.push(hit);
  }

  if (!sawBuiltin && builtin !== undefined) {
    preferred.unshift(builtinHit(builtin, domain));
  }

  // Keep query in signature for future domain-specific boosts; silence unused.
  void query;
  // Drop demoted rows from the visible window so catalog install playbooks
  // do not linger as rank-2 distractions when every hit was demoted.
  void demoted;
  const visible = [...preferred, ...kept];
  if (visible.length > 0) return visible.slice(0, topK);
  return demoted.slice(0, topK);
}

function isExternalForDomain(
  skill: { readonly name: string; readonly description: string; readonly path: string; readonly source: string },
  domain: HarnessRoutingDomain,
): boolean {
  if (skill.source === 'builtin' || skill.source === 'project' || skill.source === 'user') {
    return false;
  }
  const blob = `${skill.name}\n${skill.description}\n${skill.path}`;
  return domain.demote.test(blob);
}

function demoteNameCollisions(hits: readonly SkillSearchHit[]): SkillSearchHit[] {
  if (hits.length === 0) return [];
  const preferred: SkillSearchHit[] = [];
  const demoted: SkillSearchHit[] = [];
  for (const hit of hits) {
    const hint = harnessCollisionHint(hit.name);
    if (hint !== undefined && hit.source !== 'builtin' && hit.source !== 'project' && hit.source !== 'user') {
      demoted.push({
        ...hit,
        score: hit.score * 0.05,
        matchReason: appendReason(hit.matchReason, `demoted: name collides with ${hint}`),
      });
    } else {
      preferred.push(hit);
    }
  }
  if (preferred.length > 0) return preferred.slice(0, hits.length);
  return demoted.slice(0, hits.length);
}

function builtinHit(skill: SkillDefinition, domain: HarnessRoutingDomain): SkillSearchHit {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    type: typeof skill.metadata['type'] === 'string' ? skill.metadata['type'] : undefined,
    score: 100,
    matchReason: `builtin ${domain.preferBuiltin} preferred for ${domain.id}`,
    category:
      typeof skill.metadata['category'] === 'string' ? skill.metadata['category'] : undefined,
  };
}

function appendReason(existing: string, note: string): string {
  const base = existing.trim();
  if (base.length === 0) return note;
  if (base.includes(note)) return base;
  return `${base}; ${note}`;
}
