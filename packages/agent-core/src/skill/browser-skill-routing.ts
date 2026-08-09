/**
 * Prefer SuperLiora builtin Browser* tools over catalog Playwright/Puppeteer
 * install playbooks when SearchSkill looks like general browser automation.
 */

import type { SkillDefinition, SkillSearchHit } from './types';

const BROWSER_TASK_QUERY =
  /\b(browser|screenshot|cloakbrowser|camoufox|lightpanda|browser[-_]?use|puppeteer|playwright|web\s*automat|click_ref|Browser(?:Status|Observe|Act|Screenshot|Console)|VerifySurface|headless|chromium)\b/i;

/** Explicit e2e / Playwright-test intent — keep catalog Playwright skills. */
const EXPLICIT_PLAYWRIGHT_E2E =
  /\b(@playwright\/test|playwright\s*(test|e2e|config)|e2e\s*tests?|test\s*runner|vitest|jest)\b/i;

const EXTERNAL_BROWSER_AUTOMATION =
  /\b(playwright|puppeteer|browser-harness|cdp-browser|oc-browser|browser-ladder|super-browser|agent-browser|npm run setup|chromium\.launch|puppeteer\.launch|playwright install)\b/i;

export function isBrowserAutomationQuery(query: string): boolean {
  return BROWSER_TASK_QUERY.test(query.trim());
}

export function wantsExplicitPlaywrightE2E(query: string): boolean {
  return EXPLICIT_PLAYWRIGHT_E2E.test(query.trim());
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
  return EXTERNAL_BROWSER_AUTOMATION.test(blob);
}

/**
 * Re-rank SearchSkill hits: pin builtin `browser-use`, demote catalog
 * Playwright/Puppeteer install skills for generic browser tasks.
 */
export function rerankSkillHitsForBrowserRouting(
  query: string,
  hits: readonly SkillSearchHit[],
  builtinBrowserUse?: SkillDefinition | undefined,
): SkillSearchHit[] {
  if (hits.length === 0 && builtinBrowserUse === undefined) return [];
  if (!isBrowserAutomationQuery(query) || wantsExplicitPlaywrightE2E(query)) {
    return hits.length > 0 ? [...hits] : [];
  }

  const topK = Math.max(hits.length, builtinBrowserUse !== undefined ? 1 : 0);
  const preferred: SkillSearchHit[] = [];
  const kept: SkillSearchHit[] = [];
  const demoted: SkillSearchHit[] = [];
  let sawBuiltin = false;

  for (const hit of hits) {
    if (hit.source === 'builtin' && hit.name === 'browser-use') {
      sawBuiltin = true;
      preferred.push({
        ...hit,
        score: Math.max(hit.score, 1) + 50,
        matchReason: appendReason(hit.matchReason, 'builtin browser-use preferred'),
      });
      continue;
    }
    if (isExternalBrowserAutomationSkill(hit)) {
      demoted.push({
        ...hit,
        score: hit.score * 0.05,
        matchReason: appendReason(
          hit.matchReason,
          'demoted: prefer Builtin Browser* tools / Skill("browser-use")',
        ),
      });
      continue;
    }
    kept.push(hit);
  }

  if (!sawBuiltin && builtinBrowserUse !== undefined) {
    preferred.unshift({
      name: builtinBrowserUse.name,
      description: builtinBrowserUse.description,
      path: builtinBrowserUse.path,
      source: builtinBrowserUse.source,
      type:
        typeof builtinBrowserUse.metadata.type === 'string'
          ? builtinBrowserUse.metadata.type
          : undefined,
      score: 100,
      matchReason: 'builtin browser-use preferred for browser automation',
      category:
        typeof builtinBrowserUse.metadata.category === 'string'
          ? builtinBrowserUse.metadata.category
          : undefined,
    });
  }

  return [...preferred, ...kept, ...demoted].slice(0, topK);
}

function appendReason(existing: string, note: string): string {
  const base = existing.trim();
  if (base.length === 0) return note;
  if (base.includes(note)) return base;
  return `${base}; ${note}`;
}
