import { describe, expect, it } from 'vitest';

import {
  buildFleetCostGuardSettingsLines,
  buildFleetSessionLiveLines,
  evaluateFleetCostGuardSoft,
  FLEET_BUDGET_HARD_CAP_TIP,
  FLEET_BUDGET_HARD_CAP_TIP_KO,
  FLEET_BUDGET_USD_ENV,
  FLEET_COST_GUARD_TIP,
  FLEET_COST_GUARD_TIP_KO,
  FLEET_EVIDENCE_GATE_TIP,
  FLEET_EVIDENCE_GATE_TIP_KO,
  FLEET_GOVERNANCE_TIPS,
  FLEET_MAKER_CHECKER_SOFT_TIP,
  FLEET_MAKER_CHECKER_SOFT_TIP_KO,
  FLEET_PARALLEL_SPEEDUP_TIP,
  FLEET_WORKTREE_ENV,
  loadFleetBudgetGlance,
  OPS_FLEET_BUDGET_TIP,
  OPS_FLEET_COST_GUARD_TIP,
  OPS_FLEET_EVIDENCE_TIP,
  OPS_FLEET_MAKER_CHECKER_SOFT_TIP,
  OPS_FLEET_PARALLEL_FANOUT_TIP,
  formatFleetParallelToolsOpsLine,
  formatFleetMakerCheckerSoftLiveLine,
  formatFleetWorktreeEnvLiveLine,
  formatFleetWorktreeEnvStatusLine,
  resolveFleetParallelToolsGlanceFromStatus,
  OPS_FLEET_WORKTREE_TIP,
} from '#/tui/utils/fleet/fleet-glance';

describe('fleet governance tips', () => {
  it('documents Maker≠Checker evidence gate with swarm-evidence-gate SSOT', () => {
    expect(FLEET_EVIDENCE_GATE_TIP).toContain('Maker≠Checker');
    expect(FLEET_EVIDENCE_GATE_TIP).toContain('requiredEvidence');
    expect(FLEET_EVIDENCE_GATE_TIP).toContain('swarm-evidence-gate');
  });

  it('documents wasted-round budget hard-cap with swarm-budget SSOT', () => {
    expect(FLEET_BUDGET_HARD_CAP_TIP).toContain('≥2');
    expect(FLEET_BUDGET_HARD_CAP_TIP).toContain('swarm-budget');
    expect(FLEET_BUDGET_HARD_CAP_TIP).toMatch(/kill/i);
  });

  it('exports governance tips for Settings panel wiring', () => {
    expect(FLEET_GOVERNANCE_TIPS).toEqual([
      FLEET_EVIDENCE_GATE_TIP,
      FLEET_MAKER_CHECKER_SOFT_TIP,
      FLEET_BUDGET_HARD_CAP_TIP,
      FLEET_PARALLEL_SPEEDUP_TIP,
    ]);
  });
});

describe('fleet governance Korean brief', () => {
  it('summarizes evidence gate in Korean', () => {
    expect(FLEET_EVIDENCE_GATE_TIP_KO).toContain('Maker≠Checker');
    expect(FLEET_EVIDENCE_GATE_TIP_KO).toContain('swarm-evidence-gate');
  });

  it('summarizes maker-checker soft collision in Korean', () => {
    expect(FLEET_MAKER_CHECKER_SOFT_TIP_KO).toContain('Maker≠Checker');
    expect(FLEET_MAKER_CHECKER_SOFT_TIP_KO).toContain('swarm-maker-checker');
  });

  it('summarizes budget governor in Korean', () => {
    expect(FLEET_BUDGET_HARD_CAP_TIP_KO).toContain('≥2');
    expect(FLEET_BUDGET_HARD_CAP_TIP_KO).toContain('swarm-budget');
  });
});

describe('ops fleet governance one-liners', () => {
  it('surfaces compact evidence, soft collision, and budget lines for Ops Fleet pane', () => {
    expect(OPS_FLEET_EVIDENCE_TIP).toContain('Maker≠Checker');
    expect(OPS_FLEET_EVIDENCE_TIP).toContain('requiredEvidence');
    expect(OPS_FLEET_MAKER_CHECKER_SOFT_TIP).toContain('same expert make+check');
    expect(OPS_FLEET_BUDGET_TIP).toContain('≥2 wasted rounds');
    expect(OPS_FLEET_BUDGET_TIP).toContain('kill suggest');
    expect(OPS_FLEET_COST_GUARD_TIP).toContain('Cost Guard');
    expect(OPS_FLEET_COST_GUARD_TIP).toContain('soft-stop');
  });
});

describe('fleet parallel tools ops line', () => {
  it('resolveFleetParallelToolsGlanceFromStatus maps SessionStatus counters', () => {
    expect(resolveFleetParallelToolsGlanceFromStatus(undefined)).toBeUndefined();
    expect(resolveFleetParallelToolsGlanceFromStatus({})).toBeUndefined();
    expect(
      resolveFleetParallelToolsGlanceFromStatus({
        parallelToolsInFlight: 2,
        maxParallelTools: 4,
      }),
    ).toEqual({ parallelToolsInFlight: 2, maxParallelTools: 4 });
    expect(resolveFleetParallelToolsGlanceFromStatus({ maxParallelTools: 3 })).toEqual({
      maxParallelTools: 3,
    });
    expect(
      resolveFleetParallelToolsGlanceFromStatus({ parallelToolsInFlight: 0, maxParallelTools: 0 }),
    ).toEqual({ parallelToolsInFlight: 0, maxParallelTools: 0 });
  });

  it('falls back to soft tip when status is unwired', () => {
    expect(formatFleetParallelToolsOpsLine(undefined)).toBe(OPS_FLEET_PARALLEL_FANOUT_TIP);
  });

  it('shows live in-flight count when wired', () => {
    expect(
      formatFleetParallelToolsOpsLine({ parallelToolsInFlight: 2, maxParallelTools: 2 }),
    ).toBe('Parallel tools: 2 in flight');
    expect(
      formatFleetParallelToolsOpsLine({ parallelToolsInFlight: 2, maxParallelTools: 4 }),
    ).toBe('Parallel tools: 2 in flight · peak 4');
  });

  it('shows idle when counters are wired at zero', () => {
    expect(
      formatFleetParallelToolsOpsLine({ parallelToolsInFlight: 0, maxParallelTools: 0 }),
    ).toBe('Parallel tools: idle');
  });

  it('shows turn peak after batch drains', () => {
    expect(formatFleetParallelToolsOpsLine({ maxParallelTools: 3 })).toBe(
      'Parallel tools: idle · turn peak 3',
    );
    expect(
      formatFleetParallelToolsOpsLine({ parallelToolsInFlight: 0, maxParallelTools: 3 }),
    ).toBe('Parallel tools: idle · turn peak 3');
  });
});

describe('fleet maker-checker session live line', () => {
  it('falls back to soft tip when unwired', () => {
    expect(formatFleetMakerCheckerSoftLiveLine(undefined)).toBe(OPS_FLEET_MAKER_CHECKER_SOFT_TIP);
    expect(formatFleetMakerCheckerSoftLiveLine(null)).toBe(OPS_FLEET_MAKER_CHECKER_SOFT_TIP);
  });

  it('surfaces live warn from AppState when wired', () => {
    const warn =
      'Maker≠Checker (soft): expert auth both implements and reviews (swarm-maker-checker).';
    expect(formatFleetMakerCheckerSoftLiveLine(warn)).toBe(warn);
  });
});

describe('fleet worktree env session live line', () => {
  it('falls back to compact tip when unwired', () => {
    expect(formatFleetWorktreeEnvLiveLine(undefined)).toBe(OPS_FLEET_WORKTREE_TIP);
    expect(formatFleetWorktreeEnvLiveLine(null)).toBe(OPS_FLEET_WORKTREE_TIP);
  });

  it('surfaces live ON when SUPERLIORA_FLEET_WORKTREE is enabled', () => {
    const glance = { envEnabled: true, envValue: '1' };
    expect(formatFleetWorktreeEnvLiveLine(glance)).toContain(`${FLEET_WORKTREE_ENV}=ON`);
    expect(formatFleetWorktreeEnvStatusLine(glance)).toContain('AgentSwarm/UltraSwarm');
  });

  it('surfaces live OFF when env is unset', () => {
    const glance = { envEnabled: false, envValue: undefined };
    expect(formatFleetWorktreeEnvLiveLine(glance)).toContain(`${FLEET_WORKTREE_ENV}: off`);
  });
});

describe('fleet cost guard soft glance', () => {
  it('parses SUPERLIORA_FLEET_BUDGET_USD env cap', () => {
    expect(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5' }).budgetUsd).toBe(5);
    expect(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5.50' }).budgetUsd).toBe(5.5);
    expect(loadFleetBudgetGlance({}).budgetUsd).toBeNull();
    expect(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: 'bad' }).budgetUsd).toBeNull();
  });

  it('evaluates soft check remaining and over-budget states', () => {
    const glance = loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5' });
    const ok = evaluateFleetCostGuardSoft(glance, 1);
    expect(ok.active).toBe(true);
    expect(ok.remainingUsd).toBe(4);
    expect(ok.overBudget).toBe(false);

    const near = evaluateFleetCostGuardSoft(glance, 4.2);
    expect(near.nearBudget).toBe(true);

    const over = evaluateFleetCostGuardSoft(glance, 6);
    expect(over.overBudget).toBe(true);
    expect(over.remainingUsd).toBe(-1);
  });

  it('builds settings block with tip and soft check when env is set', () => {
    const lines = buildFleetCostGuardSettingsLines(
      loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5' }),
      1.25,
    ).join('\n');
    expect(lines).toContain(FLEET_BUDGET_USD_ENV);
    expect(lines).toContain(FLEET_COST_GUARD_TIP);
    expect(lines).toContain('Soft check:');
    expect(lines).toContain('remaining');
  });

  it('summarizes Cost Guard in Korean brief', () => {
    expect(FLEET_COST_GUARD_TIP_KO).toContain('SUPERLIORA_FLEET_BUDGET_USD');
    expect(FLEET_COST_GUARD_TIP_KO).toContain('soft-stop');
  });
});
