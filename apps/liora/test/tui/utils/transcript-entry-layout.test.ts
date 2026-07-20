import { describe, expect, it } from 'vitest';

import { type Component } from '#/tui/renderer';
import type { TUIState } from '#/tui/tui-state';
import type { TranscriptEntry } from '#/tui/types';
import { markTranscriptComponent } from '#/tui/utils/transcript-component-metadata';
import { resolveTranscriptEntryLineOffset } from '#/tui/utils/transcript-entry-layout';

function fakeComponent(height: number, widthsSeen?: number[]): Component {
  return {
    render: (width: number) => {
      widthsSeen?.push(width);
      return Array.from({ length: height }, () => 'x');
    },
    invalidate: () => {},
  };
}

function fakeEntry(id: string): TranscriptEntry {
  return { id, kind: 'assistant', turnId: 'turn-1', renderMode: 'markdown', content: '' };
}

function fakeState(children: Component[]): TUIState {
  return { transcriptContainer: { children } } as never;
}

describe('resolveTranscriptEntryLineOffset', () => {
  it('returns the accumulated line offset before the matching child', () => {
    const first = fakeComponent(2);
    const second = fakeComponent(3);
    markTranscriptComponent(second, fakeEntry('b'));
    const third = fakeComponent(4);
    markTranscriptComponent(third, fakeEntry('c'));
    const state = fakeState([first, second, third]);

    expect(resolveTranscriptEntryLineOffset(state, 'b', 80)).toBe(2);
    expect(resolveTranscriptEntryLineOffset(state, 'c', 80)).toBe(5);
  });

  it('returns 0 when the first child matches', () => {
    const target = fakeComponent(2);
    markTranscriptComponent(target, fakeEntry('a'));

    expect(resolveTranscriptEntryLineOffset(fakeState([target]), 'a', 80)).toBe(0);
  });

  it('counts children that are not bound to an entry', () => {
    // Streaming live text / idle stage children have no entry marker but
    // still occupy lines.
    const unbound = fakeComponent(3);
    const target = fakeComponent(2);
    markTranscriptComponent(target, fakeEntry('target'));

    expect(resolveTranscriptEntryLineOffset(fakeState([unbound, target]), 'target', 80)).toBe(3);
  });

  it('returns undefined when no child matches the entry id', () => {
    const child = fakeComponent(2);
    markTranscriptComponent(child, fakeEntry('a'));
    const state = fakeState([child]);

    expect(resolveTranscriptEntryLineOffset(state, 'missing', 80)).toBeUndefined();
    expect(resolveTranscriptEntryLineOffset(fakeState([]), 'a', 80)).toBeUndefined();
  });

  it('clamps the render width to at least one column', () => {
    const widths: number[] = [];
    const child = fakeComponent(1, widths);
    markTranscriptComponent(child, fakeEntry('a'));
    const state = fakeState([child]);

    // Non-matching id forces the walk to render every child.
    resolveTranscriptEntryLineOffset(state, 'missing', 0);
    resolveTranscriptEntryLineOffset(state, 'missing', -12);
    expect(widths).toEqual([1, 1]);
  });
});
