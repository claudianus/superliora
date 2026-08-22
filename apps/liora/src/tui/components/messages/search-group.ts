/**
 * SearchGroupComponent renders 2+ search/dir tool calls from the same step
 * as one group (Grep, Glob, LS, and the same verb-family).
 *
 * Same structure as `ReadGroupComponent`:
 * - one summary header and a tree body listing each pattern/path and status;
 * - permanently grouped, while the body remains visible;
 * - 200ms throttling;
 * - state stays in each `ToolCallComponent`; the group only reads snapshots.
 *
 * Header forms:
 *   pending > 0: Searching {N} patterns · Listing {M} dirs…
 *   all done:    Searched {N} patterns · {H} matches
 *   some failed: append · {F} failed
 *   all failed:  Searched {N} patterns · failed
 *
 * Body lines:
 *   TODO  · 3 matches
 *   src/*.ts  · searching…
 *   missing  · failed
 */

import type { RendererRootUI } from '#/tui/renderer';
import { Container, Text } from '#/tui/renderer';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { pluralize } from '#/tui/components/messages/tool-renderers/chip-format';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseText,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';
import { formatVerbGroupLabel } from '#/tui/features/transcript/verb-group';

import type { ToolCallComponent, ToolCallSearchSnapshot } from './tool-call';

const THROTTLE_MS = 200;

interface SearchEntry {
  readonly toolCallId: string;
  readonly tc: ToolCallComponent;
}

export function formatSearchHitTotals(snapshots: readonly ToolCallSearchSnapshot[]): string {
  let matches = 0;
  let files = 0;
  let sawMatch = false;
  let sawFile = false;
  for (const snap of snapshots) {
    if (snap.phase !== 'done') continue;
    if (snap.hitKind === 'file') {
      files += snap.hits;
      sawFile = true;
    } else {
      matches += snap.hits;
      sawMatch = true;
    }
  }
  const parts: string[] = [];
  if (sawMatch) parts.push(pluralize(matches, 'match', 'matches'));
  if (sawFile) parts.push(pluralize(files, 'file'));
  return parts.length === 0 ? '' : ` · ${parts.join(' · ')}`;
}

export class SearchGroupComponent extends Container {
  private readonly entranceStartedAtMs = appearanceAnimationNow();
  private readonly entries: SearchEntry[] = [];
  private readonly headerText: Text;
  private readonly bodyContainer: Container;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushPhases = new Map<string, ToolCallSearchSnapshot['phase']>();
  private _invalidating = false;

  constructor(private readonly ui: RendererRootUI | undefined) {
    super();
    // No leading spacer — stays in the tight thinking→tools work block.
    this.headerText = new Text('', 0, 0);
    this.addChild(this.headerText);
    this.bodyContainer = new Container();
    this.addChild(this.bodyContainer);
  }

  size(): number {
    return this.entries.length;
  }

  /**
   * Exposes borrowed tool cards for chain-bar bulk expand (same contract as
   * ReadGroupComponent — entries are not Container children).
   */
  getToolComponents(): readonly ToolCallComponent[] {
    return this.entries.map((entry) => entry.tc);
  }

  /**
   * Borrows a standalone `ToolCallComponent` into the group as a hidden state
   * container. Snapshot changes trigger throttled refreshes. Re-attaching the
   * same toolCallId is a no-op.
   */
  attach(toolCallId: string, tc: ToolCallComponent): void {
    if (this.entries.some((e) => e.toolCallId === toolCallId)) return;
    this.entries.push({ toolCallId, tc });
    tc.setSnapshotListener(() => {
      this.scheduleRender();
    });
    this.flushRender();
  }

  /**
   * The pending -> done/failed transition is the important visible change, so
   * it refreshes immediately. Other changes are throttled.
   */
  private scheduleRender(): void {
    if (this.detectPhaseTransition()) {
      this.flushRender();
      return;
    }
    if (this.throttleTimer !== null) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.flushRender();
    }, THROTTLE_MS);
  }

  private detectPhaseTransition(): boolean {
    for (const e of this.entries) {
      const phase = e.tc.getSearchSnapshot().phase;
      if (this.lastFlushPhases.get(e.toolCallId) !== phase) return true;
    }
    return false;
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) return lines;
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'tool',
      streaming: true,
    });
  }

  private flushRender(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    const snapshots = this.entries.map((e) => e.tc.getSearchSnapshot());
    let pending = 0;
    let failed = 0;
    for (const snap of snapshots) {
      if (snap.phase === 'pending') pending += 1;
      else if (snap.phase === 'failed') failed += 1;
    }
    this.headerText.setText(this.buildHeader(snapshots, pending, failed));

    this.bodyContainer.clear();
    snapshots.forEach((snap, idx) => {
      const isLast = idx === snapshots.length - 1;
      this.bodyContainer.addChild(new Text(this.buildBodyLine(snap, isLast), 0, 0));
    });

    this.lastFlushPhases.clear();
    this.entries.forEach((entry, i) => {
      const snap = snapshots[i];
      if (snap !== undefined) this.lastFlushPhases.set(entry.toolCallId, snap.phase);
    });

    this.invalidate();
    this.ui?.requestRender();
  }

  private buildHeader(
    snapshots: readonly ToolCallSearchSnapshot[],
    pending: number,
    failed: number,
  ): string {
    const dim = (text: string): string => currentTheme.dim(text);
    const labelText = formatVerbGroupLabel(
      snapshots.map((snap) => ({ name: snap.name, running: snap.phase === 'pending' })),
      { running: pending > 0 },
    );

    if (pending > 0) {
      const appearance = getActiveAppearancePreferences();
      const bullet = shouldRenderAmbientEffects(appearance)
        ? renderPulseText(STATUS_BULLET, 'search-group:pending', 'text')
        : currentTheme.fg('text', STATUS_BULLET);
      const label = currentTheme.boldFg('primary', `${labelText}…`);
      return `${bullet}${label}`;
    }

    if (failed === snapshots.length && snapshots.length > 0) {
      const bullet = currentTheme.fg('error', '✗ ');
      const label = currentTheme.boldFg('error', labelText);
      return `${bullet}${label}${currentTheme.fg('error', ' · failed')}`;
    }

    const appearance = getActiveAppearancePreferences();
    const bullet = shouldRenderAmbientEffects(appearance)
      ? renderSpectacularText(STATUS_BULLET.trimEnd(), 'search-group:done', appearance, {
          intense: false,
          pace: 'slow',
        }) + ' '
      : currentTheme.fg('success', STATUS_BULLET);
    const label = currentTheme.boldFg('primary', labelText);
    const hitsPart = dim(formatSearchHitTotals(snapshots));
    const failPart = failed > 0 ? currentTheme.fg('error', ` · ${String(failed)} failed`) : '';
    return `${bullet}${label}${hitsPart}${failPart}`;
  }

  private buildBodyLine(snap: ToolCallSearchSnapshot, isLast: boolean): string {
    const dim = (text: string): string => currentTheme.dim(text);
    const branch = isLast ? '└─' : '├─';
    const subject = snap.subject !== undefined && snap.subject.length > 0 ? snap.subject : snap.name;
    const pathPart = currentTheme.fg('text', subject);

    let tail: string;
    if (snap.phase === 'pending') {
      tail = dim(snap.kind === 'dir' ? ' · listing…' : ' · searching…');
    } else if (snap.phase === 'failed') {
      tail = currentTheme.fg('error', ' · failed');
    } else if (snap.hitKind === 'file') {
      tail = dim(` · ${pluralize(snap.hits, 'file')}`);
    } else {
      tail = dim(` · ${pluralize(snap.hits, 'match', 'matches')}`);
    }
    return `  ${branch} ${pathPart}${tail}`;
  }

  override invalidate(): void {
    if (this._invalidating) {
      super.invalidate();
      return;
    }
    this._invalidating = true;
    this.flushRender();
    this._invalidating = false;
  }

  /** Releases throttle timers so destroyed components cannot refresh later. */
  dispose(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    for (const e of this.entries) {
      e.tc.setSnapshotListener(undefined);
    }
  }
}
