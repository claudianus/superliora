import { describe, expect, it } from 'vitest';

import {
  defaultUserSurfaceLeakFailures,
  hasLoggedOutSetupNextAction,
  hasStatusPanelSetupNextAction,
  hasXpDodReadinessContract,
  shouldRequireModelSetupAction,
} from '../../../../scripts/tui-surface-leaks.mjs';

describe('TUI surface leak checks', () => {
  it('allows Ultrawork brand copy while still blocking manual slash commands', () => {
    const brandCopy = 'Describe task; Ultrawork auto-links plan, goal, helpers, verify.';

    expect(defaultUserSurfaceLeakFailures('help', brandCopy)).toEqual([]);
    expect(defaultUserSurfaceLeakFailures('status', brandCopy)).toEqual([]);
    expect(defaultUserSurfaceLeakFailures('status', 'auto ultrawork-ready')).toEqual([]);
    expect(defaultUserSurfaceLeakFailures('help', 'Turn UltraPlan mode on')).toEqual([]);
    expect(
      defaultUserSurfaceLeakFailures(
        'help',
        'Describe task; Ultrawork auto-runs UltraPlan, UltraGoal, UltraSwarm, Verify.',
      ),
    ).toContain('default help capture exposes internal Ultrawork stage list');
    expect(defaultUserSurfaceLeakFailures('status', 'Plan mode    on')).toContain(
      'default status capture exposes legacy plan mode label',
    );
    expect(defaultUserSurfaceLeakFailures('status', 'Planning     Ultrawork on')).toContain(
      'default status capture exposes legacy planning status row',
    );
    expect(
      defaultUserSurfaceLeakFailures(
        'startup',
        'Describe task; Ultrawork plans, sets goal, swarms, verifies.',
      ),
    ).toContain('default startup capture exposes legacy Ultrawork stage copy');
    expect(
      defaultUserSurfaceLeakFailures(
        'prompt-entry',
        '<ultrawork_flow>\nOperating contract:\n<untrusted_objective>',
      ),
    ).toContain('default prompt-entry capture exposes internal Ultrawork prompt contract');
    expect(defaultUserSurfaceLeakFailures('startup', 'shift-tab to Plan mode before editing')).toContain(
      'default startup capture exposes legacy plan mode label',
    );
    expect(defaultUserSurfaceLeakFailures('help', 'Shift-Tab Toggle Ultrawork planning')).toContain(
      'default help capture exposes mode-like Ultrawork shortcut',
    );

    expect(defaultUserSurfaceLeakFailures('help', 'Run /ultrawork to start.')).toContain(
      'default help capture exposes Ultrawork manual command',
    );
    expect(defaultUserSurfaceLeakFailures('autocomplete', '/ultraswarm')).toContain(
      'default autocomplete capture exposes Ultraswarm manual command',
    );
  });

  it('only requires setup actions when the screen is missing a model', () => {
    const readyScreen = [
      'Model: K2.7 Code',
      'State         Ready',
      'Scope         small focused diff; no broad refactor',
      'Coverage      test public behavior changes',
      'Screen check  open changed screen before finishing',
      'Done gate     tests + typecheck/lint/build + clean diff + TUI',
      'next: describe task; Ultrawork auto-links plan, goal, helpers, verify',
    ].join('\n');
    const setupScreen = [
      'Model: not set',
      'State         Model needed',
      'Scope         small focused diff; no broad refactor',
      'Coverage      test public behavior changes',
      'Screen check  open changed screen before finishing',
      'Done gate     tests + typecheck/lint/build + clean diff + TUI',
      'Next          Run /login or /provider first; use /model after sign-in.',
      'next: /login or /provider, then /model',
    ].join('\n');

    expect(shouldRequireModelSetupAction(readyScreen)).toBe(false);
    expect(hasXpDodReadinessContract(readyScreen)).toBe(true);

    expect(shouldRequireModelSetupAction(setupScreen)).toBe(true);
    expect(hasLoggedOutSetupNextAction(setupScreen)).toBe(true);
    expect(hasStatusPanelSetupNextAction(setupScreen)).toBe(true);
    expect(hasXpDodReadinessContract(setupScreen)).toBe(true);
  });
});
