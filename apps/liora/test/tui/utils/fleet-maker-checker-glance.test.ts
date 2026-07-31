import { describe, expect, it } from 'vitest';

import {
  makerCheckerSoftWarnFromIntegrationReport,
  makerCheckerSoftWarnFromMembers,
  resolveMakerCheckerSoftWarn,
} from '#/tui/utils/fleet/fleet-maker-checker-glance';
import {
  FLEET_MAKER_CHECKER_SOFT_TIP,
  FLEET_MAKER_CHECKER_SOFT_TIP_KO,
  OPS_FLEET_MAKER_CHECKER_SOFT_TIP,
} from '#/tui/utils/fleet/fleet-glance';

describe('fleet-maker-checker-glance', () => {
  it('detects runtime collision from integration report phases', () => {
    const warn = makerCheckerSoftWarnFromIntegrationReport({
      headline: 'done',
      agents: [
        {
          expertId: 'e-1',
          name: 'Solo',
          phase: 'implement',
          outcome: 'completed',
          verdict: 'PASS',
        },
        {
          expertId: 'e-1',
          name: 'Solo',
          phase: 'review',
          outcome: 'completed',
          verdict: 'PASS',
        },
      ],
    });
    expect(warn).toContain('Solo');
    expect(warn).toContain('swarm-maker-checker');
  });

  it('detects runtime collision from staffed member focus metadata', () => {
    const warn = makerCheckerSoftWarnFromMembers([
      {
        ultraSwarm: {
          expertId: 'e-1',
          name: 'Solo',
          focus: 'implement',
          coverageLane: 'architecture_implementation',
        },
      },
      {
        ultraSwarm: {
          expertId: 'e-1',
          name: 'Solo',
          focus: 'review',
          coverageLane: 'testing_evidence',
        },
      },
    ]);
    expect(warn).toContain('Solo');
  });

  it('prefers parsed tool output over member metadata', () => {
    const output = [
      '<expert expert_id="e-9" name="Echo" phase="implement" outcome="completed" verdict="PASS"></expert>',
      '<expert expert_id="e-9" name="Echo" phase="review" outcome="completed" verdict="PASS"></expert>',
    ].join('\n');
    const warn = resolveMakerCheckerSoftWarn({
      output,
      members: [],
    });
    expect(warn).toContain('Echo');
  });
});

describe('fleet maker-checker settings tips', () => {
  it('documents runtime soft collision alongside evidence hard gate', () => {
    expect(FLEET_MAKER_CHECKER_SOFT_TIP).toContain('Maker≠Checker');
    expect(FLEET_MAKER_CHECKER_SOFT_TIP).toContain('swarm-maker-checker');
    expect(FLEET_MAKER_CHECKER_SOFT_TIP_KO).toContain('Maker≠Checker');
    expect(OPS_FLEET_MAKER_CHECKER_SOFT_TIP).toContain('same expert make+check');
  });
});
