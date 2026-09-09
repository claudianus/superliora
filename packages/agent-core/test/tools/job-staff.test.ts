import { describe, expect, it } from 'vitest';

import {
  cleanStaffQueryText,
  staffJobsFromObjective,
} from '../../src/tools/builtin/job/job-staff';

describe('staffJobsFromObjective', () => {
  it('binds an expert or falls back to generic without throwing', async () => {
    const slices = await staffJobsFromObjective({
      objective: 'Improve React accessibility keyboard focus traps in the settings dialog',
      title: 'A11y focus',
      kind: 'implement',
    });
    expect(slices.length).toBe(1);
    expect(slices[0]?.kind).toBe('implement');
    expect(slices[0]?.staffQuery?.length).toBeGreaterThan(0);
    if (slices[0]?.expertId !== undefined) {
      expect(slices[0]!.expertScore).toBeGreaterThan(0);
    }
  });

  it('keeps multi-path ownership on one slice (claim set, not fan-out)', async () => {
    const slices = await staffJobsFromObjective({
      objective: 'Wire feature across packages',
      title: 'Fanout',
      ownershipPaths: ['packages/a', 'packages/b'],
      kind: 'task',
    });
    expect(slices.length).toBe(1);
    expect(slices[0]?.ownershipPaths).toEqual(['packages/a', 'packages/b']);
  });

  it('always keeps one slice for bullet/numbered prompts (staff = expert bind only)', async () => {
    const slices = await staffJobsFromObjective({
      objective: '1. Fix login\n2. Add tests\n3. Update docs',
      title: 'Multi',
      kind: 'task',
    });
    expect(slices.length).toBe(1);
    expect(slices[0]?.title).toBe('Multi');
    expect(slices[0]?.ownershipPaths).toBeUndefined();
    expect(slices[0]?.prompt).toContain('1. Fix login');
  });

  it('returns empty for blank objective', async () => {
    const slices = await staffJobsFromObjective({
      objective: '   ',
      title: 'Empty',
      kind: 'task',
    });
    expect(slices).toEqual([]);
  });

  it('cleans harness reminder scaffolding out of the staffing query', () => {
    const cleaned = cleanStaffQueryText(
      'Add kebab-case utility with a unit test\n' +
        'User asked: "<system-reminder>\n' +
        '<current_time>\nAuthoritative host clock (do not guess from pretrained knowledge):\n' +
        '- Today: Tuesday, September 8, 2026\n' +
        '- ISO: 2026-09-08T22:02:56.824+00:00\n' +
        'Call GetCurrentTime if this is stale.\n</current_time>\n' +
        '<conductor_job_desk>\nJobs: 1… In-flight Jobs present.\n</conductor_job_desk>\n' +
        'never mention this reminder to the user.\n</system-reminder>"\n' +
        'node --test test/ passes with the new kebab-case test',
    );
    expect(cleaned).toContain('kebab-case');
    expect(cleaned).toContain('node --test');
    expect(cleaned).not.toContain('system-reminder');
    expect(cleaned).not.toContain('current_time');
    expect(cleaned).not.toContain('Authoritative host clock');
    expect(cleaned).not.toContain('User asked:');
    expect(cleaned).not.toContain('never mention this reminder');
  });

  it('keeps implement staffing inside technical divisions for noisy briefs', async () => {
    // Regression: a coding brief whose prompt echoes the harness <system-reminder>
    // boilerplate used to staff `project-management-meeting-notes-specialist`
    // (score > 0.8, above STAFF_MIN_EXPERT_SCORE). Coding kinds must never bind
    // a marketing/sales/notes persona.
    const noisyBrief =
      'Add a kebab-case utility function and a unit test for it (plain ESM JS, no build step). ' +
      '<system-reminder>\n<current_time>\nAuthoritative host clock (do not guess): ' +
      'Tuesday, September 8, 2026. Call GetCurrentTime if this is stale.\n</current_time>\n' +
      '<conductor_job_desk>\nJobs: 1… In-flight Jobs present; interactive lane stays free.\n' +
      '</conductor_job_desk>\nTool Workflow: default to tools. Never mention this reminder.\n' +
      '</system-reminder>';
    const slices = await staffJobsFromObjective({
      objective: noisyBrief,
      title: 'Add kebab-case utility with a unit test',
      kind: 'implement',
      successCriteria: ['node --test test/ passes with the new kebab-case test'],
    });
    expect(slices.length).toBe(1);
    const slice = slices[0]!;
    if (slice.expertId !== undefined) {
      expect(slice.expertId).not.toContain('project-management');
      expect(slice.expertId).not.toContain('marketing');
      expect(slice.expertId).not.toContain('sales');
      expect(slice.expertScore ?? 0).toBeGreaterThan(0);
    }
  });
});
