import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent } from '@superliora/protocol';

import {
  MISSION_DUAL_EMIT_ENV,
  dualEmitMissionUltraworkAlias,
  isMissionDualEmitEnabled,
  maybeEmitMissionUltraworkAliasLive,
  missionDualEmitEnableReason,
  missionDualEmitStatusLine,
} from '#/mission/event-alias';
import { durableTraceRecordType } from '#/agent/agent-status-updated';
import { SOVEREIGN_UMBRELLA_ENV } from '#/profile/main-profile';

const stageChanged = {
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

describe('journal safety contract', () => {
  it('durableTraceRecordType would journal mission.* if mis-emitted via emitEvent', () => {
    expect(durableTraceRecordType('ultrawork.stage.changed')).toBe('ultrawork.event');
    expect(durableTraceRecordType('mission.stage.changed')).toBe('ultrawork.event');
  });
});

describe('mission dual-emit env gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isMissionDualEmitEnabled is false unless env is exactly 1 or sovereign umbrella', () => {
    expect(isMissionDualEmitEnabled({})).toBe(false);
    expect(isMissionDualEmitEnabled({ [MISSION_DUAL_EMIT_ENV]: '0' })).toBe(false);
    expect(isMissionDualEmitEnabled({ [MISSION_DUAL_EMIT_ENV]: 'true' })).toBe(false);
    expect(isMissionDualEmitEnabled({ [MISSION_DUAL_EMIT_ENV]: '1' })).toBe(true);
    expect(isMissionDualEmitEnabled({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toBe(true);
    expect(isMissionDualEmitEnabled({ [SOVEREIGN_UMBRELLA_ENV]: 'true' })).toBe(true);
  });

  it('missionDualEmitStatusLine reflects env gate', () => {
    expect(missionDualEmitStatusLine({})).toContain('OFF');
    expect(missionDualEmitStatusLine({})).toContain(SOVEREIGN_UMBRELLA_ENV);
    expect(missionDualEmitStatusLine({ [MISSION_DUAL_EMIT_ENV]: '1' })).toContain('ON');
    expect(missionDualEmitStatusLine({ [MISSION_DUAL_EMIT_ENV]: '1' })).toContain('journal stays ultrawork.*');
    expect(missionDualEmitStatusLine({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toContain('ON');
    expect(missionDualEmitStatusLine({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toContain(
      `${SOVEREIGN_UMBRELLA_ENV}=1`,
    );
  });

  it('missionDualEmitEnableReason prefers explicit dual-emit env over sovereign umbrella', () => {
    expect(
      missionDualEmitEnableReason({
        [MISSION_DUAL_EMIT_ENV]: '1',
        [SOVEREIGN_UMBRELLA_ENV]: '1',
      }),
    ).toBe(`${MISSION_DUAL_EMIT_ENV}=1`);
  });
});

describe('maybeEmitMissionUltraworkAliasLive', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not emit when env gate is off', () => {
    const live: AgentEvent[] = [];
    maybeEmitMissionUltraworkAliasLive((event) => live.push(event), stageChanged, {});
    expect(live).toEqual([]);
  });

  it('emits mission alias live-only when env gate is on', () => {
    const live: AgentEvent[] = [];
    maybeEmitMissionUltraworkAliasLive(
      (event) => live.push(event),
      stageChanged,
      { [MISSION_DUAL_EMIT_ENV]: '1' },
    );
    expect(live).toEqual([{ ...stageChanged, type: 'mission.stage.changed' }]);
  });

  it('emits mission alias live-only when sovereign umbrella is on', () => {
    const live: AgentEvent[] = [];
    maybeEmitMissionUltraworkAliasLive(
      (event) => live.push(event),
      stageChanged,
      { [SOVEREIGN_UMBRELLA_ENV]: '1' },
    );
    expect(live).toEqual([{ ...stageChanged, type: 'mission.stage.changed' }]);
  });

  it('ignores non-ultrawork events', () => {
    const live: AgentEvent[] = [];
    maybeEmitMissionUltraworkAliasLive(
      (event) => live.push(event),
      { type: 'turn.started', turnId: 1, origin: 'user' },
      { [MISSION_DUAL_EMIT_ENV]: '1' },
    );
    expect(live).toEqual([]);
  });
});

describe('dualEmitMissionUltraworkAlias', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits canonical only when env gate is off', () => {
    const emitted: AgentEvent[] = [];
    dualEmitMissionUltraworkAlias((payload) => emitted.push(payload), stageChanged, { env: {} });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe('ultrawork.stage.changed');
  });

  it('routes alias through emitLive when provided (journal-safe path)', () => {
    const durable: AgentEvent[] = [];
    const live: AgentEvent[] = [];
    dualEmitMissionUltraworkAlias((payload) => durable.push(payload), stageChanged, {
      env: { [MISSION_DUAL_EMIT_ENV]: '1' },
      emitLive: (payload) => live.push(payload),
    });
    expect(durable).toEqual([stageChanged]);
    expect(live).toEqual([{ ...stageChanged, type: 'mission.stage.changed' }]);
  });

  it('falls back to same sink when emitLive is omitted and env is on', () => {
    vi.stubEnv(MISSION_DUAL_EMIT_ENV, '1');
    const emitted: AgentEvent[] = [];
    dualEmitMissionUltraworkAlias((payload) => emitted.push(payload), stageChanged);
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.type).toBe('ultrawork.stage.changed');
    expect(emitted[1]?.type).toBe('mission.stage.changed');
  });
});
