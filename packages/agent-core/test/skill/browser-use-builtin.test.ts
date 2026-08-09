import { describe, expect, it } from 'vitest';

import { BROWSER_USE_SKILL } from '../../src/skill/builtin/browser-use';

describe('builtin browser-use skill', () => {
  it('routes agents to Browser* tools and bans Playwright installs', () => {
    expect(BROWSER_USE_SKILL.name).toBe('browser-use');
    expect(BROWSER_USE_SKILL.source).toBe('builtin');
    expect(BROWSER_USE_SKILL.content).toContain('BrowserStatus');
    expect(BROWSER_USE_SKILL.content).toContain('BrowserObserve');
    expect(BROWSER_USE_SKILL.content).toContain('BrowserAct');
    expect(BROWSER_USE_SKILL.content).toContain('VerifySurface');
    expect(BROWSER_USE_SKILL.content).toMatch(/do \*\*not\*\*.*playwright/i);
    expect(BROWSER_USE_SKILL.description).toMatch(/CloakBrowser/i);
  });
});
