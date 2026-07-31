import { describe, expect, it } from 'vitest';

import {
  defaultUserSurfaceLeakFailures,
  hasLoggedOutSetupNextAction,
  hasHarnessRadarStatusContract,
  hasMissionAdvancedHelpContract,
  hasMissionFooterNextAction,
  hasMissionHelpContract,
  hasMissionStatusContract,
  hasMissionTaskEntryCopy,
  hasStatusPanelSetupNextAction,
  hasXpDodReadinessContract,
  shouldRequireModelSetupAction,
} from '../../../../scripts/tui-surface-leaks.mjs';

describe('TUI surface leak checks', () => {
  it('allows Mission brand copy while still blocking manual slash commands', () => {
    const brandCopy = 'Shift-Tab toggles Mission and off.';

    expect(defaultUserSurfaceLeakFailures('help', brandCopy)).toEqual([]);
    expect(defaultUserSurfaceLeakFailures('status', brandCopy)).toEqual([]);
    expect(defaultUserSurfaceLeakFailures('status', 'auto ultrawork-ready')).toContain(
      'default status capture exposes legacy Ultrawork ready badge',
    );
    expect(defaultUserSurfaceLeakFailures('help', 'Turn UltraPlan mode on')).toContain(
      'default help capture exposes mode-like UltraPlan wording',
    );
    expect(
      defaultUserSurfaceLeakFailures(
        'help',
        'Describe task; Ultrawork auto-runs UltraPlan, UltraResearch, UltraGoal, UltraSwarm, Integrate, Verify, Learn.',
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
    expect(defaultUserSurfaceLeakFailures('startup', 'Ultrawork planning: OFF')).toContain(
      'default startup capture exposes mode-like Ultrawork notice',
    );

    expect(defaultUserSurfaceLeakFailures('help', 'Run /ultrawork to start.')).toContain(
      'default help capture exposes Ultrawork manual command',
    );
    expect(defaultUserSurfaceLeakFailures('autocomplete', '/ultraswarm')).toContain(
      'default autocomplete capture exposes Ultraswarm manual command',
    );
  });

  it('recognizes the unified Mission task-entry, help, and status surface contract', () => {
    expect(
      hasMissionTaskEntryCopy(
        'Shift-Tab toggles Mission and off.',
      ),
    ).toBe(true);
    expect(
      hasMissionTaskEntryCopy('Describe task; Ultrawork runs UltraPlan, UltraResearch, UltraGoal, UltraSwarm.'),
    ).toBe(false);
    expect(
      hasMissionFooterNextAction(
        'next: describe task; Mission will interview before goal, swarm, and edits',
      ),
    ).toBe(true);
    expect(
      hasMissionFooterNextAction(
        'Mission: research → interview → goal → swarm → integrate → verify → learn',
      ),
    ).toBe(true);
    expect(
      hasMissionFooterNextAction(
        'Workflow interview -> goal -> research -> swarm decision -> integrate -> verify -> learn',
      ),
    ).toBe(true);
    expect(
      hasMissionHelpContract(
        [
          'Shift-Tab toggles Mission and off.',
          'Normal messages stay lightweight unless Mission is on.',
        ].join('\n'),
      ),
    ).toBe(true);
    expect(
      hasMissionStatusContract(
        [
          'Mission      mode on',
          'Workflow      interview -> goal -> research -> swarm decision -> integrate -> verify -> learn',
          'Engine        Plan | Goal | Research | Fleet decision | Integrate | Verify | Learn',
          'Auto          Shift-Tab toggles Mission/off; no regex promotion for plain tasks',
          'Autonomy      bounded now -> headless target',
          'Recovery      resumable evidence ready -> durable target',
          'Tools         search first; load tools on demand',
          'Memory        prefs | session recall | long-run notes | auto-dream',
          'Flow          ███░ 3/4 verify queued',
          'Stages        Plan on | Goal ready | Swarm armed | Verify queued',
          'Next          Type task; Mission will interview before goal, swarm, and edits.',
        ].join('\n'),
      ),
    ).toBe(true);
    expect(
      hasMissionStatusContract(
        [
          'Model        not set',
          'Mission      needs readiness',
          'State         Model needed',
          'Workflow      interview -> goal -> research -> swarm decision -> integrate -> verify -> learn',
          'Engine        Plan | Goal | Research | Fleet decision | Integrate | Verify | Learn',
          'Auto          Shift-Tab toggles Mission/off; no regex promotion for plain tasks',
          'Flow          ███░ 3/4 verify blocked',
          'Stages        Plan off | Goal ready | Swarm off | Verify blocked',
          'Next          Run /login to add a provider, then /model to pick one.',
        ].join('\n'),
      ),
    ).toBe(true);

    expect(hasMissionHelpContract('Run /ultrawork manually.')).toBe(false);
    expect(hasMissionStatusContract('Mission    ready')).toBe(false);
    expect(
      hasHarnessRadarStatusContract(
        [
          'Autonomy      bounded now -> headless target',
          'Recovery      resumable evidence ready -> durable target',
          'Tools         search first; load tools on demand',
          'Memory        prefs | session recall | long-run notes | auto-dream',
        ].join('\n'),
      ),
    ).toBe(true);
    expect(hasHarnessRadarStatusContract('Tools         all tools loaded')).toBe(false);
  });

  it('recognizes the advanced Mission steering help contract', () => {
    expect(
      hasMissionAdvancedHelpContract(
        [
          'Mission is one workflow: Plan, Goal, Research, Fleet decision, Integrate, Verify, Learn.',
          'Shift-Tab toggles Mission/off; /plan steers Plan from Hub or slash.',
          'Advanced Mission controls',
          '/plan Plan mode — model writes a plan file, you approve (interview → write)',
          '/swarm Fleet parallel delegation — specialists split the task (prefer /fleet)',
        ].join('\n'),
      ),
    ).toBe(true);

    expect(
      hasMissionAdvancedHelpContract(
        [
          'Mission is one workflow: Plan, Goal, Research, Fleet decision, Integrate, Verify, Learn.',
          'Shift-Tab toggles Mission/off; /plan steers Plan from Hub or slash.',
          'Advanced Mission controls',
          '/plan Steer Plan stage; Mission enables it automatically',
          '/swarm Parallel specialists only',
        ].join('\n'),
      ),
    ).toBe(false);
  });

  it('only requires setup actions when the screen is missing a model', () => {
    const readyScreen = [
      'Model: K2.7 Code',
      'State         Ready',
      'Scope         small focused diff; no broad refactor',
      'Coverage      test public behavior changes',
      'Screen check  open changed screen before finishing',
      'Done gate     tests + typecheck/lint/build + clean diff + TUI',
      'next: Shift-Tab toggles Mission/off · /bench for Bench',
    ].join('\n');
    const setupScreen = [
      'Model: not set',
      'State         Model needed',
      'Scope         small focused diff; no broad refactor',
      'Coverage      test public behavior changes',
      'Screen check  open changed screen before finishing',
      'Done gate     tests + typecheck/lint/build + clean diff + TUI',
      'Next          Run /login to add a provider, then /model to pick one.',
      'next: /login to add a provider, then /model',
    ].join('\n');

    expect(shouldRequireModelSetupAction(readyScreen)).toBe(false);
    expect(hasXpDodReadinessContract(readyScreen)).toBe(true);

    expect(shouldRequireModelSetupAction(setupScreen)).toBe(true);
    expect(hasLoggedOutSetupNextAction(setupScreen)).toBe(true);
    expect(hasStatusPanelSetupNextAction(setupScreen)).toBe(true);
    expect(hasXpDodReadinessContract(setupScreen)).toBe(true);
  });
});
