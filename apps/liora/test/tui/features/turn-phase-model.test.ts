import { describe, expect, it } from 'vitest';

import {
  nextTurnPhase,
  phaseContentPaintsOwnHeader,
  shouldInsertPhaseBoundary,
  shouldPaintPhaseChrome,
  turnPhaseLabel,
  TURN_PHASE_ORDER,
} from '#/tui/features/transcript/turn-phase-model';

describe('turn-phase-model', () => {
  it('orders you → thinking → tools → answer', () => {
    expect([...TURN_PHASE_ORDER]).toEqual(['user', 'thinking', 'tools', 'answer']);
  });

  it('only advances phases within a turn', () => {
    expect(nextTurnPhase(undefined, 'thinking')).toBe('thinking');
    expect(nextTurnPhase('thinking', 'tools')).toBe('tools');
    expect(nextTurnPhase('tools', 'answer')).toBe('answer');
    expect(nextTurnPhase('answer', 'thinking')).toBe('answer');
    expect(nextTurnPhase('tools', 'user')).toBe('tools');
  });

  it('labels phases for chrome', () => {
    expect(turnPhaseLabel('user')).toBe('you');
    expect(turnPhaseLabel('tools')).toBe('tools');
  });

  it('paints chrome at all density levels', () => {
    for (const level of ['minimal', 'compact', 'standard', 'full'] as const) {
      expect(shouldPaintPhaseChrome(level, 'tools')).toBe(true);
    }
  });

  it('tools lack self-header only at full density (no chain bar)', () => {
    expect(phaseContentPaintsOwnHeader('tools', 'full')).toBe(false);
    expect(phaseContentPaintsOwnHeader('tools', 'standard')).toBe(true);
    expect(phaseContentPaintsOwnHeader('tools', 'minimal')).toBe(true);
    expect(phaseContentPaintsOwnHeader('thinking', 'full')).toBe(true);
    expect(phaseContentPaintsOwnHeader('answer', 'compact')).toBe(true);
  });

  it('inserts TurnPhaseBoundary only for tools at full density on phase entry', () => {
    expect(shouldInsertPhaseBoundary(undefined, 'tools', 'full')).toBe(true);
    expect(shouldInsertPhaseBoundary('thinking', 'tools', 'full')).toBe(true);
    // Second tool in same phase — no second boundary.
    expect(shouldInsertPhaseBoundary('tools', 'tools', 'full')).toBe(false);
    // Non-full densities use the chain phase bar instead.
    expect(shouldInsertPhaseBoundary(undefined, 'tools', 'standard')).toBe(false);
    expect(shouldInsertPhaseBoundary('thinking', 'tools', 'minimal')).toBe(false);
    // Content components paint their own headers.
    expect(shouldInsertPhaseBoundary(undefined, 'thinking', 'full')).toBe(false);
    expect(shouldInsertPhaseBoundary('tools', 'answer', 'full')).toBe(false);
    // Backward phase move is ignored.
    expect(shouldInsertPhaseBoundary('answer', 'tools', 'full')).toBe(false);
  });
});
