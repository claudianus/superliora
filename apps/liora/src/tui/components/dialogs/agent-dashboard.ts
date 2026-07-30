/**
 * AgentDashboard — multi-session operator view grouped by live status.
 *
 * Groups (fixed order): 입력 필요 → 작업 중 → 대기
 * Enter attaches (onSelect); Esc cancels. last_prompt is always masked upstream.
 */

import {
  Container,
  matchesKey,
  Key,
  renderRendererPanelChromeRows,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { CURRENT_MARK } from '#/tui/constant/symbols';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import {
  DASHBOARD_GROUP_LABELS_KO,
  DASHBOARD_STATUS_BADGE_KO,
  dashboardGroupCounts,
  flattenDashboardGroups,
  groupDashboardRows,
  type DashboardGroup,
  type DashboardSessionRow,
  type DashboardSessionStatus,
} from '#/tui/utils/agent/agent-dashboard-rows';

const ELLIPSIS = '…';

function formatRelativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  if (diffSec < 60) return '방금';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${String(minutes)}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}시간 전`;
  const days = Math.floor(hours / 24);
  return `${String(days)}일 전`;
}

function homeAlias(path: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && path.startsWith(home)) return '~' + path.slice(home.length);
  return path;
}

function truncatePathLeft(path: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (visibleWidth(path) <= maxWidth) return path;
  if (maxWidth === 1) return ELLIPSIS;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = [...segmenter.segment(path)].map((s) => s.segment);
  let used = 0;
  const budget = maxWidth - 1;
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

function statusThemeColor(
  status: DashboardSessionStatus,
): 'warning' | 'success' | 'textMuted' {
  switch (status) {
    case 'needs_input':
      return 'warning';
    case 'working':
      return 'success';
    case 'idle':
      return 'textMuted';
  }
}

export interface AgentDashboardOptions {
  readonly sessions: readonly DashboardSessionRow[];
  readonly loading: boolean;
  readonly currentSessionId: string;
  readonly maxVisibleSessions?: number;
  readonly onSelect: (session: DashboardSessionRow) => void;
  readonly onCancel: () => void;
  readonly onCtrlC?: () => void;
  readonly onCtrlD?: () => void;
}

export class AgentDashboardComponent extends Container implements Focusable {
  focused = false;

  private readonly sessions: readonly DashboardSessionRow[];
  private readonly loading: boolean;
  private readonly currentSessionId: string;
  private readonly maxVisibleSessions: number;
  private readonly onSelect: (session: DashboardSessionRow) => void;
  private readonly onCancel: () => void;
  private readonly onCtrlC?: () => void;
  private readonly onCtrlD?: () => void;

  private readonly groups: readonly DashboardGroup[];
  private readonly flat: readonly DashboardSessionRow[];
  private selectedIndex = 0;
  private scrollOffset = 0;

  constructor(opts: AgentDashboardOptions) {
    super();
    this.sessions = opts.sessions;
    this.loading = opts.loading;
    this.currentSessionId = opts.currentSessionId;
    this.maxVisibleSessions = opts.maxVisibleSessions ?? 8;
    this.onSelect = opts.onSelect;
    this.onCancel = opts.onCancel;
    this.onCtrlC = opts.onCtrlC;
    this.onCtrlD = opts.onCtrlD;

    this.groups = groupDashboardRows(this.sessions, { omitEmpty: false });
    this.flat = flattenDashboardGroups(this.groups);

    // Prefer selecting a needs_input session, else current, else first.
    const needsIdx = this.flat.findIndex((s) => s.status === 'needs_input');
    if (needsIdx >= 0) {
      this.selectedIndex = needsIdx;
    } else {
      const currentIdx = this.flat.findIndex((s) => s.id === this.currentSessionId);
      this.selectedIndex = Math.max(0, currentIdx);
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
    if (matchesKey(data, Key.escape)) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const session = this.flat[this.selectedIndex];
      if (session !== undefined) this.onSelect(session);
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.moveSelection(-1);
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.moveSelection(1);
      return;
    }
  }

  private moveSelection(delta: number): void {
    if (this.flat.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.flat.length) % this.flat.length;
    this.ensureVisible();
  }

  private ensureVisible(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.maxVisibleSessions) {
      this.scrollOffset = this.selectedIndex - this.maxVisibleSessions + 1;
    }
  }

  override render(width: number): string[] {
    return this.renderLines(width).map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private renderLines(width: number): string[] {
    const title = '에이전트 대시보드';
    if (this.loading) {
      return this.renderChrome(width, {
        title,
        hint: '세션 불러오는 중…',
        bodyTopGap: false,
      });
    }

    const counts = dashboardGroupCounts(this.groups);
    const summary = `입력 ${String(counts.needs_input)} · 작업 ${String(counts.working)} · 대기 ${String(counts.idle)}`;
    const hint = '↑↓ 이동 · Enter 연결 · Esc 닫기';

    if (this.flat.length === 0) {
      return this.renderChrome(width, {
        title,
        titleSuffix: currentTheme.fg('textMuted', `  ${summary}`),
        hint,
        body: [currentTheme.fg('textMuted', '표시할 세션이 없습니다.')],
        footerTopGap: false,
      });
    }

    const body: string[] = [];
    // Map flat index → row for selection highlighting across group headers.
    let flatCursor = 0;
    const visibleStart = this.scrollOffset;
    const visibleEnd = Math.min(this.flat.length, visibleStart + this.maxVisibleSessions);

    for (const group of this.groups) {
      if (group.sessions.length === 0) {
        // Show empty group header only when we want full buckets; keep compact.
        body.push(
          currentTheme.fg(
            'textDim',
            `── ${group.label} (0) ──`,
          ),
        );
        continue;
      }

      const groupStart = flatCursor;
      const groupEnd = flatCursor + group.sessions.length;
      // Skip groups entirely above/below the visible window? Still show header
      // if any session in group intersects the window.
      const intersects = groupEnd > visibleStart && groupStart < visibleEnd;
      if (intersects) {
        body.push(
          currentTheme.boldFg(
            statusThemeColor(group.id),
            `── ${group.label} (${String(group.sessions.length)}) ──`,
          ),
        );
      }

      for (let i = 0; i < group.sessions.length; i++) {
        const flatIndex = groupStart + i;
        if (flatIndex < visibleStart || flatIndex >= visibleEnd) {
          continue;
        }
        const session = group.sessions[i]!;
        const isSelected = flatIndex === this.selectedIndex;
        const isCurrent = session.id === this.currentSessionId;
        body.push(...this.renderSessionCard(width, session, isSelected, isCurrent));
      }
      flatCursor = groupEnd;
    }

    return this.renderChrome(width, {
      title,
      titleSuffix: currentTheme.fg('textMuted', `  ${summary}`),
      hint,
      body,
      footerTopGap: false,
    });
  }

  private renderChrome(
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
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'agent-dashboard:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
      ellipsis: ELLIPSIS,
    });
  }

  private renderSessionCard(
    width: number,
    session: DashboardSessionRow,
    isSelected: boolean,
    isCurrent: boolean,
  ): string[] {
    const pointer = isSelected ? renderSelectPointer('dashboard:pointer') : ' ';
    const indent = '  ';
    const indentWidth = visibleWidth(indent);
    const titleColor: 'primary' | 'text' = isSelected ? 'primary' : 'text';
    const titleStyle = (text: string) =>
      isSelected ? currentTheme.boldFg(titleColor, text) : currentTheme.fg(titleColor, text);

    const badge = DASHBOARD_STATUS_BADGE_KO[session.status];
    const badgeColor = statusThemeColor(session.status);
    const time = formatRelativeTime(session.updated_at);
    const currentMark = isCurrent ? CURRENT_MARK : '';
    const rawTitle = (session.title ?? session.id).trim() || session.id;

    const trailingParts = [
      currentTheme.fg(badgeColor, `[${badge}]`),
      time.length > 0 ? currentTheme.fg('textDim', time) : '',
      currentMark.length > 0 ? currentTheme.fg('success', currentMark) : '',
    ].filter((p) => p.length > 0);
    // Approximate trailing width with plain text for budget calc.
    const trailingPlain = ` [${badge}]${time.length > 0 ? `  ${time}` : ''}${currentMark.length > 0 ? `  ${currentMark}` : ''}`;
    const trailingWidth = visibleWidth(trailingPlain);
    const headerPrefixWidth = visibleWidth(pointer) + 1;
    const titleBudget = Math.max(8, width - headerPrefixWidth - trailingWidth);
    const shownTitle = truncateToWidth(singleLine(rawTitle), titleBudget, ELLIPSIS);

    const tone = isSelected ? 'primary' : 'textDim';
    // Pointer is already ambient-styled; do not wrap it in chalk again.
    let header = pointer + currentTheme.fg(tone, ' ');
    header += titleStyle(shownTitle);
    for (const part of trailingParts) {
      header += '  ' + part;
    }
    const card: string[] = [header];

    const fullId = session.id;
    const aliasedDir = homeAlias(session.work_dir);
    const metaGap = '   ';
    const idWidth = visibleWidth(fullId);
    const dirWidth = visibleWidth(aliasedDir);
    const idLineWidth = indentWidth + idWidth;

    if (idLineWidth + visibleWidth(metaGap) + dirWidth <= width) {
      card.push(
        indent +
          currentTheme.fg('textMuted', fullId) +
          currentTheme.fg('textDim', metaGap) +
          currentTheme.fg('textMuted', aliasedDir),
      );
    } else {
      card.push(
        indent +
          currentTheme.fg(
            'textMuted',
            truncateToWidth(fullId, Math.max(idWidth, width - indentWidth), ELLIPSIS),
          ),
      );
      const dirBudget = Math.max(8, width - indentWidth);
      card.push(indent + currentTheme.fg('textMuted', truncatePathLeft(aliasedDir, dirBudget)));
    }

    const rawPrompt = session.last_prompt?.trim();
    if (rawPrompt && rawPrompt.length > 0) {
      const promptMarker = '› ';
      const promptBudget = Math.max(8, width - indentWidth - visibleWidth(promptMarker));
      // Preserve body over chrome: keep as much of the masked prompt as possible.
      const promptText = truncateToWidth(singleLine(rawPrompt), promptBudget, ELLIPSIS);
      card.push(indent + currentTheme.fg('textDim', promptMarker + promptText));
    }

    return card;
  }
}

/** Re-export group labels for tests / help text. */
export { DASHBOARD_GROUP_LABELS_KO };
