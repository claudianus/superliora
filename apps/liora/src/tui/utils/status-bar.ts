/**
 * Bloomberg Terminal-style status bar rendered at the bottom of the TUI.
 * Shows: git branch | agent status | context usage | time
 */

import { execSync } from 'node:child_process';

export interface StatusBarData {
  /** Current git branch name (if in a git repo). */
  gitBranch?: string;
  /** Agent streaming phase. */
  agentStatus: 'idle' | 'thinking' | 'working' | 'error';
  /** Context token usage ratio (0-1). */
  contextUsage?: number;
  /** Active panel title. */
  activePanel?: string;
}

/** Cache git branch to avoid spawning a process every frame. */
let cachedBranch: string | undefined;
let branchCacheTime = 0;
const BRANCH_CACHE_TTL = 10_000; // 10 seconds

function getGitBranch(cwd: string): string | undefined {
  const now = Date.now();
  if (cachedBranch !== undefined && now - branchCacheTime < BRANCH_CACHE_TTL) {
    return cachedBranch;
  }
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      timeout: 2000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    cachedBranch = branch || undefined;
  } catch {
    cachedBranch = undefined;
  }
  branchCacheTime = now;
  return cachedBranch;
}

const STATUS_ICONS: Record<string, string> = {
  idle: '\u001B[32m●\u001B[0m',    // green dot
  thinking: '\u001B[33m◐\u001B[0m', // yellow half-circle
  working: '\u001B[36m◉\u001B[0m',  // cyan circle
  error: '\u001B[31m✖\u001B[0m',    // red X
};

const STATUS_LABELS: Record<string, string> = {
  idle: '대기',
  thinking: '추론',
  working: '작업',
  error: '오류',
};

/** Strip ANSI escape sequences for length calculation. */
function stripAnsi(s: string): string {
  return s.replace(/\u001B\[[0-9;]*m/g, '');
}

/**
 * Render the status bar as a single line of terminal-width text.
 */
export function renderStatusBar(data: StatusBarData, columns: number, cwd: string): string {
  const sep = ' \u001B[2m│\u001B[0m ';
  const leftParts: string[] = [];

  // Git branch
  const branch = getGitBranch(cwd);
  if (branch) {
    leftParts.push(`\u001B[35m ${branch}\u001B[0m`);
  }

  // Active panel
  if (data.activePanel) {
    leftParts.push(`\u001B[1m${data.activePanel}\u001B[0m`);
  }

  // Agent status
  const icon = STATUS_ICONS[data.agentStatus] ?? STATUS_ICONS['idle'];
  const label = STATUS_LABELS[data.agentStatus] ?? '대기';
  leftParts.push(`${icon} ${label}`);

  // Right side parts
  const rightParts: string[] = [];

  if (data.contextUsage !== undefined && data.contextUsage > 0) {
    const pct = Math.round(data.contextUsage * 100);
    const color = pct > 80 ? '\u001B[31m' : pct > 50 ? '\u001B[33m' : '\u001B[32m';
    rightParts.push(`${color}ctx:${pct}%\u001B[0m`);
  }

  // Time (HH:MM)
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  rightParts.push(`\u001B[2m${timeStr}\u001B[0m`);

  const left = ` ${leftParts.join(sep)}`;
  const right = `${rightParts.join(sep)} `;

  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;
  const padding = Math.max(1, columns - leftLen - rightLen);

  return `${left}${' '.repeat(padding)}${right}`;
}
