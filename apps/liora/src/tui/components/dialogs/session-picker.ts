/**
 * SessionPicker — pi-tui version of the session selection dialog.
 */

import {Container, matchesKey, Key, renderRendererPanelChromeRows, truncateToWidth, visibleWidth, type Focusable} from '#/tui/renderer';
import {CURRENT_MARK} from '#/tui/constant/symbols';
import {renderSelectPointer} from '#/tui/utils/select-pointer';
import {currentTheme} from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderShimmerPrefix,
} from '#/tui/utils/appearance-effects';
import {SearchableList} from '#/tui/utils/searchable-list';
import {isPrintableChar, printableChar} from '#/tui/utils/printable-key';

export interface SessionRow {
  readonly id: string;
  readonly title: string | null;
  readonly last_prompt?: string | null;
  readonly work_dir: string;
  readonly updated_at: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

const ELLIPSIS = '…';

function formatRelativeTime(ts: number): string {
  // SessionSummary timestamps come from filesystem stat `*timeMs`,
  // so they use the same millisecond unit as `Date.now()`.
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  if (diffSec < 60) return 'just now';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

function homeAlias(path: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && path.startsWith(home)) return '~' + path.slice(home.length);
  return path;
}

// Truncates from the LEFT (keeps the tail), prefixing an ellipsis when clipped.
// Paths typically carry the relevant info near the end, so we drop the prefix.
function truncatePathLeft(path: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(path) <= maxWidth) return path;
  if (maxWidth === 1) return ELLIPSIS;
  // Walk graphemes from the end accumulating width, keep the longest tail
  // whose width + ellipsis fits.
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = [...segmenter.segment(path)].map((s) => s.segment);
  let used = 0;
  const budget = maxWidth - 1; // reserve 1 column for ellipsis
  let i = segments.length - 1;
  while (i >= 0) {
    const seg = segments[i];
    if (seg === undefined) break;
    const w = visibleWidth(seg);
    if (used + w > budget) break;
    used += w;
    i--;
  }
  return ELLIPSIS + segments.slice(i + 1).join('');
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function sessionSearchText(session: SessionRow): string {
  // Match against the title, the last prompt, and the working directory so a
  // session can be found by what was asked or where it ran — not only by name.
  return singleLine(
    [session.title ?? session.id, session.last_prompt ?? '', session.work_dir].join(' '),
  );
}

/** Same cap as the `/title` command keeps server-side. */
const MAX_TITLE_LENGTH = 200;

export class SessionPickerComponent extends Container implements Focusable {
  private sessions: SessionRow[];
  private currentSessionId: string;
  private onSelect: (session: SessionRow) => void;
  private onCancel: () => void;
  private onToggleScope?: (selectedSessionId: string) => void;
  private maxVisibleSessions: number;
  private pageSize: number;
  private visibleCount: number;
  private scope: 'cwd' | 'all';
  private loading: boolean;
  private list: SearchableList<SessionRow>;
  private onRename?: (session: SessionRow, newTitle: string) => Promise<void> | void;
  /** Non-null while the inline rename editor owns the keyboard. */
  private renaming: {sessionId: string; draft: string} | null = null;
  private renamePending = false;

  focused = false;

  constructor(opts: {
    sessions: SessionRow[];
    loading: boolean;
    currentSessionId: string;
    scope?: 'cwd' | 'all';
    initialSelectedSessionId?: string;
    pageSize?: number;
    onSelect: (session: SessionRow) => void;
    onCancel: () => void;
    onCtrlC?: () => void;
    onCtrlD?: () => void;
    onToggleScope?: (selectedSessionId: string) => void;
    /**
     * Persist a new title for the given session. Rejecting (or throwing)
     * signals failure — the picker keeps the previous title and assumes the
     * host already surfaced the error.
     */
    onRename?: (session: SessionRow, newTitle: string) => Promise<void> | void;
    maxVisibleSessions?: number;
  }) {
    super();
    this.sessions = opts.sessions;
    this.loading = opts.loading;
    this.currentSessionId = opts.currentSessionId;
    this.scope = opts.scope ?? 'cwd';
    this.onSelect = opts.onSelect;
    this.onCancel = opts.onCancel;
    this.onToggleScope = opts.onToggleScope;
    this.onRename = opts.onRename;
    this.maxVisibleSessions = opts.maxVisibleSessions ?? 4;
    this.pageSize = Math.max(1, opts.pageSize ?? 50);
    const initialIndex = this.resolveInitialSelectedIndex(opts.initialSelectedSessionId);
    this.list = new SearchableList({
      items: this.sessions,
      toSearchText: sessionSearchText,
      pageSize: this.pageSize,
      initialIndex,
      searchable: true,
    });
    const initialLoadedPages = Math.ceil((initialIndex + 1) / this.pageSize);
    this.visibleCount = Math.min(this.sessions.length, initialLoadedPages * this.pageSize);
    this.onCtrlC = opts.onCtrlC;
    this.onCtrlD = opts.onCtrlD;
  }

  private readonly onCtrlC?: () => void;
  private readonly onCtrlD?: () => void;

  private resolveInitialSelectedIndex(initialSelectedSessionId: string | undefined): number {
    if (initialSelectedSessionId === undefined) return 0;
    const index = this.sessions.findIndex((session) => session.id === initialSelectedSessionId);
    return Math.max(index, 0);
  }

  private filteredSessions(): readonly SessionRow[] {
    return this.list.view().items;
  }

  private loadedSessions(sessions: readonly SessionRow[] = this.filteredSessions()): SessionRow[] {
    return sessions.slice(0, Math.min(sessions.length, this.visibleCount));
  }

  private syncVisibleCount(previousQuery: string): void {
    const view = this.list.view();
    if (view.query !== previousQuery) {
      this.visibleCount = Math.min(view.items.length, this.pageSize);
      return;
    }

    const loadedCount = Math.min(view.items.length, this.visibleCount);
    if (view.selectedIndex >= loadedCount - 1 && loadedCount < view.items.length) {
      this.visibleCount = Math.min(view.items.length, this.visibleCount + this.pageSize);
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.ctrl('c'))) {
      this.onCtrlC?.();
      return;
    }
    if (matchesKey(data, Key.ctrl('d'))) {
      this.onCtrlD?.();
      return;
    }
    if (this.renaming !== null) {
      this.handleRenameInput(data);
      return;
    }
    if (matchesKey(data, Key.ctrl('a'))) {
      this.onToggleScope?.(this.list.selected()?.id ?? this.currentSessionId);
      return;
    }
    if (matchesKey(data, Key.ctrl('r'))) {
      this.beginRename();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.list.clearQuery()) {
        this.visibleCount = Math.min(this.filteredSessions().length, this.pageSize);
        return;
      }
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const session = this.list.selected();
      if (session) this.onSelect(session);
      return;
    }

    const previousQuery = this.list.view().query;
    if (this.list.handleKey(data)) {
      this.syncVisibleCount(previousQuery);
    }
  }

  private beginRename(): void {
    if (this.onRename === undefined || this.loading || this.renamePending) return;
    const selected = this.list.selected();
    if (selected === undefined) return;
    this.renaming = {sessionId: selected.id, draft: selected.title ?? ''};
  }

  private handleRenameInput(data: string): void {
    const renaming = this.renaming;
    if (renaming === null) return;
    if (matchesKey(data, Key.escape)) {
      this.renaming = null;
      return;
    }
    if (matchesKey(data, Key.enter)) {
      void this.commitRename(renaming);
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      // Operate on code points so astral characters delete in one keystroke.
      const chars = [...renaming.draft];
      chars.pop();
      renaming.draft = chars.join('');
      return;
    }
    const ch = printableChar(data);
    if (isPrintableChar(ch) && renaming.draft.length < MAX_TITLE_LENGTH) {
      renaming.draft += ch;
    }
  }

  private async commitRename(renaming: {sessionId: string; draft: string}): Promise<void> {
    const newTitle = singleLine(renaming.draft).slice(0, MAX_TITLE_LENGTH);
    this.renaming = null;
    const session = this.sessions.find((item) => item.id === renaming.sessionId);
    if (session === undefined || this.onRename === undefined) return;
    if (newTitle.length === 0 || newTitle === (session.title ?? '')) return;
    this.renamePending = true;
    try {
      await this.onRename(session, newTitle);
      this.applyRenamedTitle(session.id, newTitle);
    } catch {
      // The host surfaced the failure; keep the previous title.
    } finally {
      this.renamePending = false;
    }
  }

  private applyRenamedTitle(sessionId: string, newTitle: string): void {
    const index = this.sessions.findIndex((item) => item.id === sessionId);
    if (index < 0) return;
    const previous = this.sessions[index];
    if (previous === undefined) return;
    this.sessions[index] = {...previous, title: newTitle};
    // SearchableList items are immutable, so rebuild the search index over the
    // updated rows. The cursor lands on the renamed row; an active query clears.
    this.list = new SearchableList({
      items: this.sessions,
      toSearchText: sessionSearchText,
      pageSize: this.pageSize,
      initialIndex: index,
      searchable: true,
    });
    this.visibleCount = Math.min(this.sessions.length, this.pageSize);
  }

  override render(width: number): string[] {
    return this.renderLines(width).map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  // Builds the raw lines; `render()` applies a final width clamp so no line
  // can ever exceed the terminal width. The per-line budgets below keep the
  // layout tidy at normal widths, but on a very narrow terminal those budgets
  // floor at a minimum and the trailing time/badge are appended in full, so
  // the clamp in `render()` is what guarantees the renderer's invariant and
  // prevents the "Rendered line exceeds terminal width" crash (issue #240).
  private renderLines(width: number): string[] {
    const title = this.scope === 'all' ? 'All sessions' : 'Sessions';
    const scopeHint =
      this.onToggleScope === undefined
        ? undefined
        : this.scope === 'all'
          ? 'Ctrl+A current cwd'
          : 'Ctrl+A all';

    if (this.loading) {
      return this.renderChromeRows(width, {
        title,
        hint: this.loadingHint(),
        bodyTopGap: false,
        footerTopGap: false,
      });
    }

    if (this.renaming !== null) {
      return this.renderRenameRows(width, title);
    }

    if (this.sessions.length === 0) {
      const hintParts = [scopeHint, 'Esc cancel'].filter(
        (item): item is string => item !== undefined,
      );
      return this.renderChromeRows(width, {
        title,
        hint: hintParts.join(' · '),
        body: [currentTheme.fg('textMuted', 'No sessions found.')],
        footerTopGap: false,
      });
    }

    const view = this.list.view();
    const titleSuffix =
      view.query.length === 0 ? currentTheme.fg('textMuted', '  (type to search)') : '';
    const hintParts = [
      ...(view.query.length > 0 ? ['Backspace clear'] : []),
      '↑↓ navigate',
      scopeHint,
      ...(this.onRename !== undefined ? ['Ctrl+R rename'] : []),
      'Enter select',
      'Esc cancel',
    ].filter((item): item is string => item !== undefined);

    const body: string[] = [];

    if (view.query.length > 0) {
      body.push(currentTheme.fg('primary', 'Search: ') + currentTheme.fg('text', view.query));
    }

    const loadedSessions = this.loadedSessions(view.items);
    if (loadedSessions.length === 0) {
      body.push(currentTheme.fg('textMuted', 'No matches'));
      return this.renderChromeRows(width, {
        title,
        titleSuffix,
        hint: hintParts.join(' · '),
        body,
        footerTopGap: false,
      });
    }
    const selectedIndex = view.selectedIndex;
    const visibleStart = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(this.maxVisibleSessions / 2),
        Math.max(0, loadedSessions.length - this.maxVisibleSessions),
      ),
    );
    const visibleSessions = loadedSessions.slice(
      visibleStart,
      visibleStart + this.maxVisibleSessions,
    );

    for (const [vi, session] of visibleSessions.entries()) {
      const index = visibleStart + vi;
      const isSelected = index === selectedIndex;
      const isCurrent = session.id === this.currentSessionId;
      const card = this.renderSessionCard(width, session, isSelected, isCurrent);
      body.push(...card);
      if (vi < visibleSessions.length - 1) body.push('');
    }

    const footerRows: string[] = [];
    const filteredCount = view.items.length;
    if (loadedSessions.length > visibleSessions.length || view.query.length > 0) {
      const totalSuffix =
        view.query.length > 0
          ? `${String(loadedSessions.length)} loaded / ${String(filteredCount)} matches`
          : loadedSessions.length === this.sessions.length
            ? `${String(loadedSessions.length)} sessions`
            : `${String(loadedSessions.length)} loaded / ${String(this.sessions.length)} sessions`;
      const footer = `Showing ${String(visibleStart + 1)}-${String(visibleStart + visibleSessions.length)} of ${totalSuffix}`;
      footerRows.push(currentTheme.fg('textMuted', footer));
    }

    return this.renderChromeRows(width, {
      title,
      titleSuffix,
      hint: hintParts.join(' · '),
      body,
      footer: footerRows,
      footerTopGap: footerRows.length > 0,
    });
  }

  /**
   * Inline rename editor. Replaces the list body while active; the static
   * block cursor is a glyph, not an animation, so no clock is involved.
   */
  private renderRenameRows(width: number, title: string): string[] {
    const renaming = this.renaming;
    if (renaming === null) return [];
    const session = this.sessions.find((item) => item.id === renaming.sessionId);
    const draftPart =
      renaming.draft.length > 0
        ? currentTheme.fg('text', renaming.draft)
        : currentTheme.fg('textDim', 'new title');
    const body: string[] = [
      currentTheme.fg('primary', 'Rename: ') + draftPart + currentTheme.fg('primary', '▌'),
    ];
    if (session !== undefined) {
      body.push(currentTheme.fg('textMuted', `id ${session.id}`));
    }
    return this.renderChromeRows(width, {
      title,
      hint: 'Enter save · Esc cancel · Backspace edit',
      body,
      footerTopGap: false,
    });
  }

  /**
   * Clock-driven shimmer on the loading line while the session scan runs.
   * `renderShimmerPrefix` returns '' when ambient effects are unavailable
   * (off / SSH / NO_COLOR / CI), leaving the exact static hint bytes.
   */
  private loadingHint(): string {
    return `${renderShimmerPrefix(getActiveAppearancePreferences())}Loading sessions...`;
  }

  private renderChromeRows(
    width: number,
    options: {
      readonly title: string;
      readonly titleSuffix?: string;
      readonly hint?: string;
      readonly body?: readonly string[];
      readonly footer?: readonly string[];
      readonly bodyTopGap?: boolean;
      readonly footerTopGap?: boolean;
    },
  ): string[] {
    return renderRendererPanelChromeRows({
      width,
      title: options.title,
      titleSuffix: options.titleSuffix,
      hint: options.hint,
      body: options.body,
      footer: options.footer,
      bodyTopGap: options.bodyTopGap,
      footerTopGap: options.footerTopGap,
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'session-picker:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
      ellipsis: ELLIPSIS,
    });
  }

  private renderSessionCard(
    width: number,
    session: SessionRow,
    isSelected: boolean,
    isCurrent: boolean,
  ): string[] {
    const pointer = isSelected ? renderSelectPointer('session:pointer') : ' ';
    const indent = '  ';
    const indentWidth = visibleWidth(indent);
    const titleColor: 'primary' | 'text' = isSelected ? 'primary' : 'text';
    const titleStyle = (text: string) =>
      isSelected ? currentTheme.boldFg(titleColor, text) : currentTheme.fg(titleColor, text);

    const time = formatRelativeTime(session.updated_at);
    const badge = isCurrent ? CURRENT_MARK : '';
    const rawTitle = (session.title ?? session.id).trim() || session.id;
    const titleSource = rawTitle;

    // Inline trailing parts after the title: "<title>  <time>  ← current".
    const trailingParts = [time, badge].filter((p) => p.length > 0);
    const trailingText = trailingParts.length > 0 ? '  ' + trailingParts.join('  ') : '';
    const trailingWidth = visibleWidth(trailingText);
    const headerPrefixWidth = visibleWidth(pointer) + 1; // pointer + space
    const titleBudget = Math.max(8, width - headerPrefixWidth - trailingWidth);
    const shownTitle = truncateToWidth(singleLine(titleSource), titleBudget, ELLIPSIS);

    const tone = isSelected ? 'primary' : 'textDim';
    // Pointer is already ambient-styled; do not wrap it in chalk again.
    let header = pointer + currentTheme.fg(tone, ' ');
    header += titleStyle(shownTitle);
    if (time.length > 0) header += '  ' + currentTheme.fg('textDim', time);
    if (badge.length > 0) header += '  ' + currentTheme.fg('success', badge);
    const card: string[] = [header];

    // Session id is rendered in full at normal widths (the final clamp in
    // `render()` truncates it only when the terminal is narrower than the id).
    // The directory wraps to its own line if it would push past the edge.
    const fullId = session.id;
    const idWidth = visibleWidth(fullId);
    const metaGap = '   ';
    const metaGapWidth = visibleWidth(metaGap);
    const idLineWidth = indentWidth + idWidth;
    const aliasedDir = homeAlias(session.work_dir);
    const dirWidth = visibleWidth(aliasedDir);

    if (idLineWidth + metaGapWidth + dirWidth <= width) {
      card.push(
        indent +
          currentTheme.fg('textMuted', fullId) +
          currentTheme.fg('textDim', metaGap) +
          currentTheme.fg('textMuted', aliasedDir),
      );
    } else {
      // Not enough room for both on one line — keep the id intact and put the
      // directory on the next line (left-truncated only if it still doesn't fit).
      card.push(
        indent +
          currentTheme.fg(
            'textMuted',
            truncateToWidth(fullId, Math.max(idWidth, width - indentWidth), ELLIPSIS),
          ),
      );
      const dirBudget = Math.max(8, width - indentWidth);
      const dir = truncatePathLeft(aliasedDir, dirBudget);
      card.push(indent + currentTheme.fg('textMuted', dir));
    }

    const rawPrompt = session.last_prompt?.trim();
    if (rawPrompt && rawPrompt.length > 0) {
      const promptMarker = '› ';
      const promptMarkerWidth = visibleWidth(promptMarker);
      const promptBudget = Math.max(8, width - indentWidth - promptMarkerWidth);
      const promptText = truncateToWidth(singleLine(rawPrompt), promptBudget, ELLIPSIS);
      const promptLine = indent + currentTheme.fg('textDim', promptMarker + promptText);
      card.push(promptLine);
    }

    return card;
  }
}
