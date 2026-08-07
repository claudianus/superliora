import { describe, expect, it } from 'vitest';

import {
  collapseLowSignalOps,
  formatMissionBash,
  formatMissionPath,
  formatMissionTarget,
  isLowSignalBash,
  pathLeaf,
  stripLeadingCd,
} from '#/tui/utils/tools/mission-target';

describe('mission-target', () => {
  it('strips leading cd chains and detects low-signal bash', () => {
    expect(stripLeadingCd('cd /tmp && pnpm test')).toEqual({
      residual: 'pnpm test',
      cdPath: '/tmp',
    });
    expect(isLowSignalBash('cd /Users/me/.superliora/worktrees/abc/repo')).toBe(true);
    expect(isLowSignalBash('cd /tmp && pnpm test')).toBe(false);
  });

  it('formats pure-cd as enter <leaf>', () => {
    expect(formatMissionBash('cd /Users/me/.superliora/worktrees/16-4a12/repo')).toBe(
      'enter repo',
    );
    expect(formatMissionBash('cd /tmp && pnpm run gate')).toBe('pnpm run gate');
  });

  it('collapses worktree paths and preserves the filename', () => {
    const long =
      '/Users/me/.superliora/worktrees/16-4a12d7da/conductor-xyz/apps/liora/src/tui/panel.ts';
    // Worktree prefix stripped; still long → last two segments.
    expect(formatMissionPath(long, undefined, 40)).toBe('tui/panel.ts');
    expect(formatMissionPath(long, undefined, 20)).toMatch(/panel\.ts$/);
    expect(formatMissionPath(long, undefined, 80)).toBe(
      'conductor-xyz/apps/liora/src/tui/panel.ts',
    );
    expect(pathLeaf(long)).toBe('panel.ts');
  });

  it('relativizes against workspace when possible', () => {
    expect(
      formatMissionPath('/repo/apps/liora/src/a.ts', '/repo', 40),
    ).toBe('apps/liora/src/a.ts');
  });

  it('routes Bash vs path targets by tool name', () => {
    expect(formatMissionTarget('Bash', 'cd /tmp && echo hi', undefined)).toBe('echo hi');
    expect(
      formatMissionTarget(
        'Edit',
        '/Users/x/.superliora/worktrees/id/proj/src/panel.ts',
        undefined,
      ),
    ).toMatch(/panel\.ts$/);
  });

  it('collapses consecutive low-signal bash ops for the same worker', () => {
    const ops = [
      { name: 'Bash', target: 'cd /a', workerId: 'w1' },
      { name: 'Bash', target: 'cd /b', workerId: 'w1' },
      { name: 'Edit', target: 'src/a.ts', workerId: 'w1' },
      { name: 'Bash', target: 'cd /c', workerId: 'w1' },
      { name: 'Bash', target: 'cd /d && ls', workerId: 'w1' },
    ];
    const collapsed = collapseLowSignalOps(ops);
    expect(collapsed).toHaveLength(4);
    expect(collapsed[0]!.target).toBe('cd /b');
    expect(collapsed[1]!.name).toBe('Edit');
    expect(collapsed[2]!.target).toBe('cd /c');
    expect(collapsed[3]!.target).toBe('cd /d && ls');
  });
});
