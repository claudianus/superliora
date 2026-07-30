import {
  cloneAtomicRange,
  historySnapshotsEqual,
  type RendererTextInputHistorySnapshot,
} from './text-input-edit';
import type {
  RendererTextInputAtomicRange,
  RendererTextInputCursor,
} from './text-input-types';

/**
 * Undo/redo stack helpers for `RendererTextInput`. Snapshot shape and equality
 * live in text-input-edit; this module handles stack push/restore with plain
 * values so the class stays thin.
 */

export function createTextInputHistorySnapshot(params: {
  readonly lines: readonly string[];
  readonly cursor: RendererTextInputCursor;
  readonly atomicRanges: readonly RendererTextInputAtomicRange[];
  readonly selectionAnchor: number | undefined;
}): RendererTextInputHistorySnapshot {
  const snapshot: {
    lines: readonly string[];
    cursor: RendererTextInputCursor;
    atomicRanges: readonly RendererTextInputAtomicRange[];
    selectionAnchor?: number;
  } = {
    lines: [...params.lines],
    cursor: { ...params.cursor },
    atomicRanges: params.atomicRanges.map(cloneAtomicRange),
  };
  if (params.selectionAnchor !== undefined) snapshot.selectionAnchor = params.selectionAnchor;
  return snapshot;
}

export function restoreTextInputHistorySnapshot(
  snapshot: RendererTextInputHistorySnapshot,
): {
  readonly lines: string[];
  readonly cursor: RendererTextInputCursor;
  readonly atomicRanges: readonly RendererTextInputAtomicRange[];
  readonly selectionAnchor: number | undefined;
} {
  return {
    lines: [...snapshot.lines],
    cursor: { ...snapshot.cursor },
    atomicRanges: snapshot.atomicRanges.map(cloneAtomicRange),
    selectionAnchor: snapshot.selectionAnchor,
  };
}

export function pushTextInputUndoSnapshot(
  undoStack: RendererTextInputHistorySnapshot[],
  redoStack: RendererTextInputHistorySnapshot[],
  snapshot: RendererTextInputHistorySnapshot,
  current: RendererTextInputHistorySnapshot,
  historyLimit: number,
): {
  readonly undoStack: RendererTextInputHistorySnapshot[];
  readonly redoStack: RendererTextInputHistorySnapshot[];
} {
  if (historyLimit <= 0 || historySnapshotsEqual(snapshot, current)) {
    return { undoStack, redoStack };
  }
  const nextUndo = [...undoStack, snapshot];
  if (nextUndo.length > historyLimit) {
    nextUndo.splice(0, nextUndo.length - historyLimit);
  }
  return { undoStack: nextUndo, redoStack: [] };
}
