import {
  RendererTranscriptViewport,
  type RendererTranscriptScrollAction,
  type RendererViewportSnapshot,
} from '#/tui/renderer';

export type TranscriptScrollAction = RendererTranscriptScrollAction;

export class TranscriptViewportState extends RendererTranscriptViewport {}

export function createTranscriptViewportState(): TranscriptViewportState {
  return new TranscriptViewportState();
}

export function syncTranscriptViewport(
  state: TranscriptViewportState,
  contentRows: number,
  visibleRows: number,
): void {
  state.sync(contentRows, visibleRows);
}

export function transcriptViewportStart(state: TranscriptViewportState): number {
  return state.start();
}

export function transcriptViewportSnapshot(
  state: TranscriptViewportState,
): RendererViewportSnapshot {
  return state.snapshot();
}

export function scrollTranscriptViewport(
  state: TranscriptViewportState,
  action: TranscriptScrollAction,
): boolean {
  return state.scroll(action);
}
