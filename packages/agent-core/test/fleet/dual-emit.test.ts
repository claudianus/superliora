import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent } from '@superliora/protocol';

import { durableTraceRecordType } from '#/agent/agent-status-updated';
import {
  FLEET_DUAL_EMIT_ENV,
  dualEmitFleetUltraworkAlias,
  fleetDualEmitEnableReason,
  isFleetDualEmitEnabled,
  maybeEmitFleetUltraworkAliasLive,
  fleetDualEmitStatusLine,
} from '#/fleet/event-alias';
import { SOVEREIGN_UMBRELLA_ENV } from '#/profile/main-profile';

const swarmPaused = {
  type: 'ultrawork.swarm.paused',
  runId: 'run-1',
  reason: 'operator',
} satisfies AgentEvent;

describe('fleet journal safety contract', () => {
  it('durableTraceRecordType journals ultrawork.* but not fleet.* mis-emits', () => {
    expect(durableTraceRecordType('ultrawork.swarm.paused')).toBe('ultrawork.event');
    expect(durableTraceRecordType('fleet.swarm.paused')).toBeUndefined();
  });
});

describe('fleet dual-emit env gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isFleetDualEmitEnabled is false unless env is exactly 1 or sovereign umbrella', () => {
    expect(isFleetDualEmitEnabled({})).toBe(false);
    expect(isFleetDualEmitEnabled({ [FLEET_DUAL_EMIT_ENV]: '0' })).toBe(false);
    expect(isFleetDualEmitEnabled({ [FLEET_DUAL_EMIT_ENV]: 'true' })).toBe(false);
    expect(isFleetDualEmitEnabled({ [FLEET_DUAL_EMIT_ENV]: '1' })).toBe(true);
    expect(isFleetDualEmitEnabled({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toBe(true);
    expect(isFleetDualEmitEnabled({ [SOVEREIGN_UMBRELLA_ENV]: 'true' })).toBe(true);
  });

  it('fleetDualEmitStatusLine reflects env gate', () => {
    expect(fleetDualEmitStatusLine({})).toContain('OFF');
    expect(fleetDualEmitStatusLine({})).toContain(SOVEREIGN_UMBRELLA_ENV);
    expect(fleetDualEmitStatusLine({ [FLEET_DUAL_EMIT_ENV]: '1' })).toContain('ON');
    expect(fleetDualEmitStatusLine({ [FLEET_DUAL_EMIT_ENV]: '1' })).toContain('journal stays ultrawork.*');
    expect(fleetDualEmitStatusLine({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toContain('ON');
    expect(fleetDualEmitStatusLine({ [SOVEREIGN_UMBRELLA_ENV]: '1' })).toContain(
      `${SOVEREIGN_UMBRELLA_ENV}=1`,
    );
  });

  it('fleetDualEmitEnableReason prefers explicit dual-emit env over sovereign umbrella', () => {
    expect(
      fleetDualEmitEnableReason({
        [FLEET_DUAL_EMIT_ENV]: '1',
        [SOVEREIGN_UMBRELLA_ENV]: '1',
      }),
    ).toBe(`${FLEET_DUAL_EMIT_ENV}=1`);
  });
});

describe('maybeEmitFleetUltraworkAliasLive', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not emit when env gate is off', () => {
    const live: AgentEvent[] = [];
    maybeEmitFleetUltraworkAliasLive((event) => live.push(event), swarmPaused, {});
    expect(live).toEqual([]);
  });

  it('emits fleet alias live-only when env gate is on', () => {
    const live: AgentEvent[] = [];
    maybeEmitFleetUltraworkAliasLive(
      (event) => live.push(event),
      swarmPaused,
      { [FLEET_DUAL_EMIT_ENV]: '1' },
    );
    expect(live).toEqual([{ ...swarmPaused, type: 'fleet.swarm.paused' }]);
  });

  it('emits fleet alias live-only when sovereign umbrella is on', () => {
    const live: AgentEvent[] = [];
    maybeEmitFleetUltraworkAliasLive(
      (event) => live.push(event),
      swarmPaused,
      { [SOVEREIGN_UMBRELLA_ENV]: '1' },
    );
    expect(live).toEqual([{ ...swarmPaused, type: 'fleet.swarm.paused' }]);
  });

  it('ignores non-fleet ultrawork events', () => {
    const live: AgentEvent[] = [];
    maybeEmitFleetUltraworkAliasLive(
      (event) => live.push(event),
      {
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
      },
      { [FLEET_DUAL_EMIT_ENV]: '1' },
    );
    expect(live).toEqual([]);
  });
});

describe('dualEmitFleetUltraworkAlias', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits canonical only when env gate is off', () => {
    const emitted: AgentEvent[] = [];
    dualEmitFleetUltraworkAlias((payload) => emitted.push(payload), swarmPaused, { env: {} });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe('ultrawork.swarm.paused');
  });

  it('routes alias through emitLive when provided (journal-safe path)', () => {
    const durable: AgentEvent[] = [];
    const live: AgentEvent[] = [];
    dualEmitFleetUltraworkAlias((payload) => durable.push(payload), swarmPaused, {
      env: { [FLEET_DUAL_EMIT_ENV]: '1' },
      emitLive: (payload) => live.push(payload),
    });
    expect(durable).toEqual([swarmPaused]);
    expect(live).toEqual([{ ...swarmPaused, type: 'fleet.swarm.paused' }]);
  });
});
