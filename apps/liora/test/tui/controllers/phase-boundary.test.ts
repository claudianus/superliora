import { describe, expect, it } from 'vitest';
import { Container } from '#/tui/renderer';

import { TurnPhaseBoundaryComponent } from '#/tui/components/messages/turn-phase-boundary';
import { UserMessageComponent } from '#/tui/components/messages/user-message';
import {
  createPhaseBoundaryState,
  noteStreamPhase,
  resetPhaseBoundaryState,
} from '#/tui/controllers/streaming-ui/phase-boundary';
import type { TUIState } from '#/tui/tui-state';

function mockState(detail: TUIState['transcriptDetail']): TUIState {
  const transcriptContainer = new Container();
  return {
    transcriptContainer,
    transcriptDetail: detail,
    renderer: { invalidateFrame: () => {} },
  } as unknown as TUIState;
}

describe('noteStreamPhase', () => {
  it('mounts TurnPhaseBoundary once for tools at full density', () => {
    const state = mockState('full');
    state.transcriptContainer.addChild(new UserMessageComponent('hi'));
    const tracker = createPhaseBoundaryState();

    expect(noteStreamPhase(state, tracker, 'thinking')).toBe(false);
    expect(noteStreamPhase(state, tracker, 'tools')).toBe(true);
    expect(noteStreamPhase(state, tracker, 'tools')).toBe(false);

    const boundaries = state.transcriptContainer.children.filter(
      (c) => c instanceof TurnPhaseBoundaryComponent,
    );
    expect(boundaries).toHaveLength(1);
  });

  it('does not mount tools boundary when chain bar covers non-full density', () => {
    const state = mockState('standard');
    const tracker = createPhaseBoundaryState();
    expect(noteStreamPhase(state, tracker, 'tools')).toBe(false);
    expect(
      state.transcriptContainer.children.some((c) => c instanceof TurnPhaseBoundaryComponent),
    ).toBe(false);
  });

  it('resets on new user message turn', () => {
    const state = mockState('full');
    state.transcriptContainer.addChild(new UserMessageComponent('first'));
    const tracker = createPhaseBoundaryState();
    expect(noteStreamPhase(state, tracker, 'tools')).toBe(true);

    state.transcriptContainer.addChild(new UserMessageComponent('second'));
    expect(noteStreamPhase(state, tracker, 'tools')).toBe(true);
    const boundaries = state.transcriptContainer.children.filter(
      (c) => c instanceof TurnPhaseBoundaryComponent,
    );
    expect(boundaries).toHaveLength(2);
  });

  it('resetPhaseBoundaryState clears tracker', () => {
    const tracker = createPhaseBoundaryState();
    tracker.phase = 'tools';
    tracker.turnIndex = 3;
    resetPhaseBoundaryState(tracker);
    expect(tracker.phase).toBeUndefined();
    expect(tracker.turnIndex).toBe(-1);
  });
});
