import { describe, expect, it } from 'vitest';

import { BROWSER_USE_SKILL } from '../../src/skill/builtin/browser-use';
import {
  isExternalBrowserAutomationSkill,
  rerankSkillHitsForBrowserRouting,
} from '../../src/skill/browser-skill-routing';
import type { SkillSearchHit } from '../../src/skill/types';

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

describe('browser skill routing', () => {
  it('detects catalog Playwright/Puppeteer install skills', () => {
    expect(
      isExternalBrowserAutomationSkill({
        name: 'playwright-skill',
        description: 'Complete browser automation with Playwright. npm run setup.',
        path: '/catalog/luokai-playwright-skill',
        source: 'extra',
      }),
    ).toBe(true);
    expect(
      isExternalBrowserAutomationSkill({
        name: 'browser-use',
        description: 'Builtin CloakBrowser tools',
        path: 'builtin://browser-use',
        source: 'builtin',
      }),
    ).toBe(false);
  });

  it('pins builtin browser-use and demotes catalog Playwright for browser queries', () => {
    const ranked = rerankSkillHitsForBrowserRouting(
      'browser screenshot automate UI click',
      [
        hit({
          name: 'playwright-skill',
          source: 'extra',
          description: 'Playwright browser automation; npm run setup installs Chromium',
          score: 10,
        }),
        hit({
          name: 'react-expert',
          source: 'extra',
          description: 'React patterns',
          score: 2,
        }),
      ],
      BROWSER_USE_SKILL,
    );
    expect(ranked[0]?.name).toBe('browser-use');
    expect(ranked[0]?.source).toBe('builtin');
    // Demoted catalog Playwright falls out of the original top_k window.
    expect(ranked.some((row) => row.name === 'playwright-skill')).toBe(false);
    expect(ranked.some((row) => row.name === 'react-expert')).toBe(true);
  });

  it('does not demote when the query asks for Playwright e2e tests', () => {
    const ranked = rerankSkillHitsForBrowserRouting(
      'playwright test e2e checkout flow',
      [
        hit({
          name: 'playwright-skill',
          source: 'extra',
          description: 'Playwright browser automation',
          score: 10,
        }),
      ],
      BROWSER_USE_SKILL,
    );
    expect(ranked[0]?.name).toBe('playwright-skill');
    expect(ranked[0]?.score).toBe(10);
  });
});
