import { describe, expect, it } from 'vitest';

import { agentEventSchema, eventSchema } from '../events';
import {
  fleetUltraworkEventAlias,
  isFleetUltraworkEventType,
  normalizeFleetUltraworkEventAlias,
  normalizeMissionOrFleetUltraworkEventAlias,
} from '../events/fleet-alias';

const samplePaused = {
  type: 'ultrawork.swarm.paused',
  runId: 'run-1',
  reason: 'budget',
} as const;

describe('protocol/events/fleet-alias', () => {
  it('recognizes fleet.* aliases for collaboration/swarm suffixes', () => {
    expect(isFleetUltraworkEventType('fleet.swarm.paused')).toBe(true);
    expect(isFleetUltraworkEventType('fleet.collaboration.message')).toBe(true);
    expect(isFleetUltraworkEventType('fleet.stage.changed')).toBe(false);
    expect(isFleetUltraworkEventType('ultrawork.swarm.paused')).toBe(false);
  });

  it('maps fleet.* to ultrawork.* on read normalize', () => {
    const aliased = {
      ...samplePaused,
      type: 'fleet.swarm.paused',
    };
    expect(normalizeFleetUltraworkEventAlias(aliased)).toEqual(samplePaused);
    expect(fleetUltraworkEventAlias('fleet.swarm.paused')).toBe('ultrawork.swarm.paused');
  });

  it('normalizeMissionOrFleetUltraworkEventAlias handles both prefixes', () => {
    expect(
      normalizeMissionOrFleetUltraworkEventAlias({
        ...samplePaused,
        type: 'fleet.swarm.paused',
      }),
    ).toEqual(samplePaused);
    expect(
      normalizeMissionOrFleetUltraworkEventAlias({
        type: 'mission.stage.changed',
      }).type,
    ).toBe('ultrawork.stage.changed');
  });

  it('agentEventSchema accepts fleet.swarm.paused and normalizes to ultrawork', () => {
    const parsed = agentEventSchema.parse({
      ...samplePaused,
      type: 'fleet.swarm.paused',
    });
    expect(parsed.type).toBe('ultrawork.swarm.paused');
  });

  it('eventSchema accepts fleet.* on session envelopes', () => {
    const parsed = eventSchema.parse({
      ...samplePaused,
      type: 'fleet.swarm.paused',
      agentId: 'agent-1',
      sessionId: 'session-1',
    });
    expect(parsed.type).toBe('ultrawork.swarm.paused');
    expect(parsed.agentId).toBe('agent-1');
  });
});
