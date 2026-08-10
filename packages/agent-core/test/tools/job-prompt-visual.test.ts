import { describe, expect, it } from 'vitest';

import { jobPrompt } from '../../src/tools/builtin/job/job-worker';
import type { JobRecord } from '../../src/tools/builtin/job/job-store-key';

function job(partial: Partial<JobRecord>): JobRecord {
  return {
    id: 'job_1',
    title: partial.title ?? 'Job',
    status: 'running',
    kind: 'task',
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as JobRecord;
}

describe('jobPrompt visual DoD', () => {
  it('adds visual DoD bullets for web surfaceKind jobs', () => {
    const text = jobPrompt(
      job({
        title: 'Landing hero',
        prompt: 'Rebuild the marketing landing hero with premium craft',
        surfaceKind: 'web',
      }),
    );
    expect(text).toContain('Visual DoD');
    expect(text).toContain('premium-visual');
    expect(text).toContain('VerifySurface');
    expect(text).toContain('BrowserScreenshot alone does not set visual=passed');
    expect(text).toContain('do not BrowserAct-explore or reinstall loops');
  });

  it('adds TUI smoke DoD for tui surfaceKind (not VerifySurface load+interaction)', () => {
    const text = jobPrompt(
      job({
        title: 'Idle stage',
        prompt: 'Polish TUI idle stage',
        surfaceKind: 'tui',
      }),
    );
    expect(text).toContain('Visual DoD');
    expect(text).toMatch(/smoke:visual/);
    expect(text).toMatch(/VerifySurface is N\/A for TUI/);
  });

  it('omits visual DoD without surfaceKind (path/title keywords alone are not enough)', () => {
    const text = jobPrompt(
      job({
        title: 'Landing hero',
        prompt: 'Rebuild the marketing landing hero with premium craft',
      }),
    );
    expect(text).not.toContain('Visual DoD');
  });

  it('omits visual DoD for surfaceKind=none', () => {
    const text = jobPrompt(
      job({
        title: 'CLI fix',
        prompt: 'Fix argv parsing in the CLI',
        surfaceKind: 'none',
      }),
    );
    expect(text).not.toContain('Visual DoD');
  });
});

describe('jobPrompt media DoD', () => {
  it('adds Media DoD for task/implement workers', () => {
    for (const kind of ['task', 'implement'] as const) {
      const text = jobPrompt(
        job({
          kind,
          title: 'Ship hero sprite',
          prompt: 'Add a player sprite',
          surfaceKind: 'none',
        }),
      );
      expect(text, kind).toContain('Media DoD');
      expect(text, kind).toContain('GenerateImage/GenerateVideo');
      expect(text, kind).toContain('ReadMediaFile');
      expect(text, kind).toContain('style seed');
    }
  });

  it('omits Media DoD for explore/verify/research', () => {
    for (const kind of ['explore', 'verify', 'research'] as const) {
      const text = jobPrompt(
        job({
          kind,
          title: 'Find sprite loader',
          prompt: 'Locate asset pipeline',
        }),
      );
      expect(text, kind).not.toContain('Media DoD');
    }
  });
});
