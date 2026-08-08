import { describe, expect, it } from 'vitest';

import {
  formatStageChecklist,
  orderedStagesForSource,
  stageFraction,
  stageLabel,
} from '#/tui/utils/upgrade/upgrade-stage-ui';

describe('upgrade-stage-ui', () => {
  it('keeps stage fractions monotonic for pipeline stages', () => {
    const pipeline = orderedStagesForSource('github-checkout');
    let prev = -1;
    for (const stage of pipeline) {
      if (stage === 'failed') continue;
      const next = stageFraction(stage);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
    expect(stageFraction('done')).toBe(1);
  });

  it('failed stage preserves previous fraction', () => {
    expect(stageFraction('failed', 0.55)).toBe(0.55);
    expect(stageFraction('failed', 0)).toBe(0.4);
  });

  it('labels stages for display', () => {
    expect(stageLabel('building')).toBe('Building');
    expect(stageLabel('downloading')).toBe('Downloading');
  });

  it('builds github checklist with active spinner marker', () => {
    const rows = formatStageChecklist('github-checkout', 'building');
    expect(rows.map((r) => r.stage)).toEqual([
      'checking',
      'bootstrapping',
      'fetching',
      'building',
      'installing',
      'sidecars',
      'done',
    ]);
    expect(rows.find((r) => r.stage === 'checking')?.marker).toBe('done');
    expect(rows.find((r) => r.stage === 'building')?.marker).toBe('active');
    expect(rows.find((r) => r.stage === 'installing')?.marker).toBe('pending');
  });

  it('builds native checklist around downloading', () => {
    const rows = formatStageChecklist('native', 'downloading');
    expect(rows.map((r) => r.stage)).toEqual([
      'checking',
      'bootstrapping',
      'downloading',
      'installing',
      'sidecars',
      'done',
    ]);
    expect(rows.find((r) => r.stage === 'downloading')?.marker).toBe('active');
  });


  it('marks package pipeline downloading stage', () => {
    const rows = formatStageChecklist('npm-global', 'downloading');
    expect(rows.map((r) => r.stage)).toContain('downloading');
    expect(rows.find((r) => r.stage === 'downloading')?.marker).toBe('active');
  });
});
