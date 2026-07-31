import { describe, expect, it } from 'vitest';

import {
  buildWarRoomRestaffSteerDirective,
  defaultWarRoomReason,
  formatWarRoomRestaffReason,
  resolveWarRoomReason,
} from '#/tui/features/agent-swarm/war-room-action';

describe('war-room-action helpers', () => {
  it('defaults pause and restaff reasons', () => {
    expect(defaultWarRoomReason('pause')).toBe('Paused from war room');
    expect(defaultWarRoomReason('restaff')).toBe('User requested restaff');
    expect(resolveWarRoomReason('pause')).toBe('Paused from war room');
    expect(resolveWarRoomReason('restaff', '  ')).toBe('User requested restaff');
    expect(resolveWarRoomReason('restaff', ' Close QA gaps ')).toBe('Close QA gaps');
  });

  it('formats restaff reason with optional phase', () => {
    expect(formatWarRoomRestaffReason({})).toBe('User requested restaff');
    expect(formatWarRoomRestaffReason({ reason: 'Close gaps', phase: 'review' })).toBe(
      'Close gaps (phase: review)',
    );
    expect(formatWarRoomRestaffReason({ phase: '  implement  ' })).toBe(
      'User requested restaff (phase: implement)',
    );
  });

  it('builds steer fallback directive when force restaff is rejected', () => {
    const directive = buildWarRoomRestaffSteerDirective({
      reason: 'Close QA gaps',
      phase: 'review',
    });
    expect(directive).toContain('Fleet restaff requested from war room.');
    expect(directive).toContain('Close QA gaps');
    expect(directive).toContain('(phase: review)');
    expect(directive).toContain('staffing additional specialists');
  });
});
