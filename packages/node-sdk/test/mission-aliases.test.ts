import { describe, expect, it } from 'vitest';

import {
  MissionRunStateMachine,
  buildMissionRecoveryPrompt,
  maybeAdvanceMissionStage,
  MISSION_STAGE_ORDER,
} from '#/index';

describe('mission aliases (sdk re-export)', () => {
  it('exports MissionRunStateMachine alias', () => {
    const machine = MissionRunStateMachine.create({
      id: 'sdk_mission_alias_1',
      objective: 'Verify sdk re-export wiring',
      now: '2026-07-31T00:00:00.000Z',
    });

    expect(MissionRunStateMachine).toBeTypeOf('function');
    expect(machine.snapshot()).toMatchObject({
      id: 'sdk_mission_alias_1',
      objective: 'Verify sdk re-export wiring',
      status: 'running',
      stage: 'intake',
    });
  });

  it('re-exports mission-named helper aliases', () => {
    expect(typeof buildMissionRecoveryPrompt).toBe('function');
    expect(typeof maybeAdvanceMissionStage).toBe('function');
    expect(MISSION_STAGE_ORDER.length).toBeGreaterThan(0);
    expect(MISSION_STAGE_ORDER[0]).toBe('intake');
  });
});
