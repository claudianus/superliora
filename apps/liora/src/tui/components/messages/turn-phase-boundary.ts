/**
 * Lightweight phase boundary row between work-units.
 * Inserted once at phase start when the following content does not already
 * paint its own phase header (or needs a stronger visual break).
 */

import type { Component } from '#/tui/renderer';
import {
  formatPhaseHeaderLine,
  type TranscriptPhaseKind,
} from '#/tui/features/transcript/transcript-phase-tint';

export class TurnPhaseBoundaryComponent implements Component {
  private readonly kind: TranscriptPhaseKind;
  private detail: string | undefined;

  constructor(kind: TranscriptPhaseKind, detail?: string) {
    this.kind = kind;
    this.detail = detail;
  }

  setDetail(detail: string | undefined): void {
    this.detail = detail;
  }

  invalidate(): void {
    // Stateless paint — nothing to cache.
  }

  render(width: number): string[] {
    return ['', formatPhaseHeaderLine(this.kind, this.detail, Math.max(1, width))];
  }
}
