import { describe, expect, it } from 'vitest';

import { BROWSER_USE_SKILL } from '../../src/skill/builtin/browser-use';
import { COMPUTER_USE_SKILL } from '../../src/skill/builtin/computer-use';
import { GIT_SAFE_SKILL } from '../../src/skill/builtin/git-safe';
import { RESEARCH_USE_SKILL } from '../../src/skill/builtin/research-use';
import {
  harnessCollisionHint,
  isBlockedSkillRisk,
  rerankSkillHitsForHarnessRouting,
} from '../../src/skill/harness-skill-routing';
import type { SkillDefinition, SkillSearchHit } from '../../src/skill/types';

function hit(
  partial: Partial<SkillSearchHit> & Pick<SkillSearchHit, 'name' | 'source'>,
): SkillSearchHit {
  return {
    description: partial.description ?? partial.name,
    path: partial.path ?? `/catalog/${partial.name}`,
    score: partial.score ?? 1,
    matchReason: partial.matchReason ?? 'test',
    ...partial,
  };
}

function builtins(...skills: SkillDefinition[]): Map<string, SkillDefinition> {
  return new Map(skills.map((skill) => [skill.name, skill]));
}

describe('harness skill routing', () => {
  it('blocks critical and offensive risk tiers', () => {
    expect(isBlockedSkillRisk('high')).toBe(true);
    expect(isBlockedSkillRisk('critical')).toBe(true);
    expect(isBlockedSkillRisk('offensive')).toBe(true);
    expect(isBlockedSkillRisk('safe')).toBe(false);
    expect(isBlockedSkillRisk(undefined)).toBe(false);
  });

  it('pins research-use and demotes tavily for web search queries', () => {
    const ranked = rerankSkillHitsForHarnessRouting(
      'web search latest CVE documentation',
      [
        hit({
          name: 'tavily',
          source: 'extra',
          description: 'Tavily API search via node scripts',
          score: 10,
        }),
        hit({
          name: 'react-expert',
          source: 'extra',
          description: 'React patterns',
          score: 2,
        }),
      ],
      builtins(RESEARCH_USE_SKILL),
    );
    expect(ranked[0]?.name).toBe('research-use');
    expect(ranked.some((row) => row.name === 'tavily')).toBe(false);
  });

  it('pins computer-use and demotes pyautogui catalog skills', () => {
    const ranked = rerankSkillHitsForHarnessRouting(
      'desktop click computer-use automation',
      [
        hit({
          name: 'computer-use-agents',
          source: 'extra',
          description: 'Anthropic computer use with pyautogui',
          score: 9,
        }),
      ],
      builtins(COMPUTER_USE_SKILL),
    );
    expect(ranked[0]?.name).toBe('computer-use');
    expect(ranked.some((row) => row.name === 'computer-use-agents')).toBe(false);
  });

  it('pins git-safe for ordinary commit queries', () => {
    const ranked = rerankSkillHitsForHarnessRouting(
      'git commit conventional commits message',
      [
        hit({
          name: 'smart-git-automation',
          source: 'extra',
          description: 'smart-git auto-commit orchestration',
          score: 8,
        }),
      ],
      builtins(GIT_SAFE_SKILL),
    );
    expect(ranked[0]?.name).toBe('git-safe');
    expect(ranked.some((row) => row.name === 'smart-git-automation')).toBe(false);
  });

  it('still demotes Playwright for browser queries and keeps e2e carve-out', () => {
    const browser = rerankSkillHitsForHarnessRouting(
      'browser screenshot automate UI',
      [
        hit({
          name: 'playwright-skill',
          source: 'extra',
          description: 'Playwright browser automation',
          score: 10,
        }),
        hit({
          name: 'skyvern-browser-automation',
          source: 'extra',
          description: 'Skyvern browser automation',
          score: 9,
        }),
      ],
      builtins(BROWSER_USE_SKILL),
    );
    expect(browser[0]?.name).toBe('browser-use');
    expect(browser.some((row) => row.name === 'playwright-skill')).toBe(false);

    const e2e = rerankSkillHitsForHarnessRouting(
      'playwright test e2e checkout',
      [
        hit({
          name: 'playwright-skill',
          source: 'extra',
          description: 'Playwright browser automation',
          score: 10,
        }),
      ],
      builtins(BROWSER_USE_SKILL),
    );
    expect(e2e[0]?.name).toBe('playwright-skill');
  });

  it('drops harness name collisions when non-colliding hits remain', () => {
    expect(harnessCollisionHint('context7')).toContain('Context7');
    const ranked = rerankSkillHitsForHarnessRouting(
      'unrelated query about cooking',
      [
        hit({
          name: 'context7',
          source: 'extra',
          description: 'bun scripts for docs',
          score: 5,
        }),
        hit({
          name: 'cooking',
          source: 'extra',
          description: 'recipes',
          score: 1,
        }),
      ],
      builtins(),
    );
    expect(ranked.map((row) => row.name)).toEqual(['cooking']);
  });
});
