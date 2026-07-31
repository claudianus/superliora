import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UltraworkRunStateMachine,
  MissionRunStateMachine,
  buildMissionRecoveryPrompt,
  maybeAdvanceMissionStage,
  MISSION_STAGE_ORDER,
  isMissionUltraworkEventType,
  missionUltraworkEventAlias,
  normalizeMissionUltraworkEventAlias,
  dualEmitMissionUltraworkAlias,
  MISSION_DUAL_EMIT_ENV,
} from '#/mission';
import type { AgentEvent } from '@superliora/protocol';

describe('mission facade', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('re-exports ultrawork public API', () => {
    const machine = UltraworkRunStateMachine.create({
      id: 'mission_facade_1',
      objective: 'Verify facade wiring',
      now: '2026-07-31T00:00:00.000Z',
    });

    expect(machine.snapshot()).toMatchObject({
      id: 'mission_facade_1',
      objective: 'Verify facade wiring',
      status: 'running',
      stage: 'intake',
    });
  });

  it('re-exports mission-named aliases for high-traffic helpers', () => {
    expect(MissionRunStateMachine).toBe(UltraworkRunStateMachine);
    expect(typeof buildMissionRecoveryPrompt).toBe('function');
    expect(typeof maybeAdvanceMissionStage).toBe('function');
    expect(MISSION_STAGE_ORDER.length).toBeGreaterThan(0);
    expect(MISSION_STAGE_ORDER[0]).toBe('intake');
  });

  it('re-exports mission ultrawork event alias helpers', () => {
    expect(isMissionUltraworkEventType('mission.stage.changed')).toBe(true);
    expect(missionUltraworkEventAlias('mission.stage.changed')).toBe('ultrawork.stage.changed');
    expect(
      normalizeMissionUltraworkEventAlias({
        type: 'mission.stage.changed',
        runId: 'run-1',
      }),
    ).toEqual({ type: 'ultrawork.stage.changed', runId: 'run-1' });
  });

  it('dualEmitMissionUltraworkAlias emits canonical then mission alias when enabled', () => {
    vi.stubEnv(MISSION_DUAL_EMIT_ENV, '1');
    const emitted: AgentEvent[] = [];
    const event = {
      type: 'ultrawork.stage.changed',
      run: {
        id: 'run-1',
        objective: 'Ship',
        status: 'running',
        stage: 'intake',
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
      to: 'plan',
    } satisfies AgentEvent;

    dualEmitMissionUltraworkAlias((payload) => emitted.push(payload), event);

    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.type).toBe('ultrawork.stage.changed');
    expect(emitted[1]?.type).toBe('mission.stage.changed');
  });
});
