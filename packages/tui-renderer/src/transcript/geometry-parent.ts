import type { Component } from '../text/component';

/**
 * Parent that can dirty one child's row-count slot without a full-tree
 * invalidate. Registered when a child is mounted under a transcript viewport.
 */
export interface RendererTranscriptGeometryParent {
  invalidateChildGeometry(child: Component): void;
}

/**
 * Maps mounted transcript children → their viewport parent. Weak so GC cleans
 * up when either side is dropped. Used so in-place height mutations
 * (streaming tool results, expand/collapse) can dirty geometry without every
 * mutator knowing about the transcript container.
 */
const geometryParents = new WeakMap<Component, RendererTranscriptGeometryParent>();

export function registerTranscriptGeometryParent(
  parent: RendererTranscriptGeometryParent,
  child: Component,
): void {
  geometryParents.set(child, parent);
}

export function unregisterTranscriptGeometryParent(child: Component): void {
  geometryParents.delete(child);
}

/**
 * Mark one mounted transcript child's row count dirty. No-op when the child is
 * not under a registered viewport (unit tests, detached components).
 */
export function notifyTranscriptChildGeometryDirty(child: Component): void {
  geometryParents.get(child)?.invalidateChildGeometry(child);
}
