import { describe, expect, it } from 'vitest';

import { agentEventSchema, eventSchema, ultraworkStageChangedEventSchema } from '../events';
import {
  isMissionUltraworkEventType,
  missionUltraworkEventAlias,
  normalizeMissionUltraworkEventAlias,
} from '../events/mission-alias';

const sampleStageChanged = {
  type: 'ultrawork.stage.changed',
  run: {
    id: 'run-1',
    objective: 'Ship feature',
    status: 'running',
    stage: 'intake',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  },
  to: 'plan',
} as const;

describe('protocol/events/mission-alias', () => {
  it('recognizes mission.* aliases for known ultrawork suffixes', () => {
    expect(isMissionUltraworkEventType('mission.stage.changed')).toBe(true);
    expect(isMissionUltraworkEventType('mission.swarm.restaff_requested')).toBe(true);
    expect(isMissionUltraworkEventType('mission.unknown.event')).toBe(false);
    expect(isMissionUltraworkEventType('ultrawork.stage.changed')).toBe(false);
  });

  it('maps mission.* to ultrawork.* on read normalize', () => {
    const aliased = {
      ...sampleStageChanged,
      type: 'mission.stage.changed',
    };
    expect(normalizeMissionUltraworkEventAlias(aliased)).toEqual(sampleStageChanged);
    expect(missionUltraworkEventAlias('mission.stage.changed')).toBe('ultrawork.stage.changed');
  });

  it('agentEventSchema accepts mission.stage.changed and normalizes to ultrawork', () => {
    const parsed = agentEventSchema.parse({
      ...sampleStageChanged,
      type: 'mission.stage.changed',
    });
    expect(parsed.type).toBe('ultrawork.stage.changed');
    expect(ultraworkStageChangedEventSchema.parse(parsed)).toEqual(parsed);
  });

  it('eventSchema accepts mission.* on session envelopes', () => {
    const parsed = eventSchema.parse({
      ...sampleStageChanged,
      type: 'mission.stage.changed',
      agentId: 'agent-1',
      sessionId: 'session-1',
    });
    expect(parsed.type).toBe('ultrawork.stage.changed');
    expect(parsed.agentId).toBe('agent-1');
  });
});
