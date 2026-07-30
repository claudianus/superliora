import type { BackgroundTaskInfo, BackgroundTaskStatus } from '@superliora/sdk';
import { truncateToWidth, visibleWidth } from '#/tui/renderer';

export const ELLIPSIS = '…';

export const STOP_CONFIRM_TIMEOUT_MS = 5_000;

export const MIN_WIDTH = 48;
export const MIN_HEIGHT = 10;

export const LIST_COL_MIN = 28;
export const LIST_COL_MAX = 44;
export const LIST_COL_RATIO = 0.32;

export const STATUS_LABEL: Record<BackgroundTaskStatus, string> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed out',
  killed: 'killed',
  lost: 'lost',
};

export function statusColor(status: BackgroundTaskStatus): 'success' | 'textMuted' | 'error' {
  switch (status) {
    case 'running':
      return 'success';
    case 'completed':
      return 'textMuted';
    case 'failed':
    case 'timed_out':
    case 'killed':
    case 'lost':
      return 'error';
  }
}

export function isTerminal(status: BackgroundTaskStatus): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'timed_out' ||
    status === 'killed' ||
    status === 'lost'
  );
}

export function formatRelativeTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts) || ts <= 0) return '';
  const diffSec = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  if (diffSec < 60) return 'just now';
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

export function padToWidth(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w === width) return line;
  if (w > width) return truncateToWidth(line, width, ELLIPSIS);
  return line + ' '.repeat(width - w);
}

export function fitExactly(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  return padToWidth(s, width);
}

export function visibleTasks(
  tasks: readonly BackgroundTaskInfo[],
  filter: 'all' | 'active',
): BackgroundTaskInfo[] {
  const backgroundOnly = tasks.filter((t) => t.detached !== false);
  if (filter === 'all') return [...backgroundOnly];
  return backgroundOnly.filter((t) => !isTerminal(t.status));
}

export function compareTasks(a: BackgroundTaskInfo, b: BackgroundTaskInfo): number {
  const aTerminal = isTerminal(a.status);
  const bTerminal = isTerminal(b.status);
  if (aTerminal !== bTerminal) return aTerminal ? 1 : -1;
  if (!aTerminal) return a.startedAt - b.startedAt;
  return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt);
}

export interface StatusCounts {
  running: number;
  completed: number;
  terminalFailed: number;
}

export function countByStatus(tasks: readonly BackgroundTaskInfo[]): StatusCounts {
  const counts: StatusCounts = { running: 0, completed: 0, terminalFailed: 0 };
  for (const t of tasks) {
    switch (t.status) {
      case 'running':
        counts.running += 1;
        break;
      case 'completed':
        counts.completed += 1;
        break;
      case 'failed':
      case 'timed_out':
      case 'killed':
      case 'lost':
        counts.terminalFailed += 1;
        break;
    }
  }
  return counts;
}
