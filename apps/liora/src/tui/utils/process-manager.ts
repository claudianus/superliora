/**
 * ProcessManager — monitor and manage system processes.
 *
 * Provides process monitoring UI:
 * - Process list with PID, name, CPU%, MEM%, status
 * - Sort by any column
 * - Filter by name/status
 * - Tree view (parent-child relationships)
 * - Kill signal sending (SIGTERM, SIGKILL)
 * - Resource usage bars (CPU/MEM per process)
 * - Total system resource summary
 * - Process search
 * - Auto-refresh indicator
 * - Top-N mode (show only top consumers)
 *
 * Visual style:
 * ┌─ Processes ──────────────────────── CPU: 45% MEM: 62% ┐
 * │  PID  NAME            CPU%  MEM%  STATUS              │
 * │  1024 node           ████░ 12.3  8.2  running        │
 * │  1025 ├─ worker      ██░░░  5.1  3.4  running        │
 * │  1026 └─ worker      █░░░░  2.8  2.1  sleeping       │
 * │  2048 chrome         █████ 28.4 24.5  running        │
 * │  3072 vim            ░░░░░  0.1  1.2  sleeping       │
 * │                                                       │
 * │ [k]ill [r]efresh [s]ort:CPU  5 processes | Top: node  │
 * └───────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessStatus = 'running' | 'sleeping' | 'stopped' | 'zombie' | 'idle';

export interface ProcessInfo {
  readonly pid: number;
  readonly name: string;
  readonly cpu: number; // percentage
  readonly memory: number; // percentage
  readonly status: ProcessStatus;
  readonly ppid?: number; // parent PID
  readonly user?: string;
  readonly startTime?: number;
  readonly command?: string;
}

export interface SystemResources {
  readonly cpuUsage: number; // 0-100
  readonly memUsage: number; // 0-100
  readonly memTotal: number; // bytes
  readonly memUsed: number; // bytes
  readonly loadAvg: [number, number, number];
  readonly uptime: number; // seconds
}

export type SortColumn = 'pid' | 'name' | 'cpu' | 'memory' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface ProcessRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showTree?: boolean;
  readonly showSummary?: boolean;
  readonly topN?: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// ProcessManager
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<ProcessStatus, string> = {
  running: '●', sleeping: '○', stopped: '■', zombie: '☠', idle: '◇',
};

const STATUS_TOKENS: Record<ProcessStatus, string> = {
  running: 'success', sleeping: 'textMuted', stopped: 'warning', zombie: 'error', idle: 'textDim',
};

export class ProcessManager {
  private processes: Map<number, ProcessInfo> = new Map();
  private system: SystemResources = { cpuUsage: 0, memUsage: 0, memTotal: 0, memUsed: 0, loadAvg: [0, 0, 0], uptime: 0 };
  private sortColumn: SortColumn = 'cpu';
  private sortDirection: SortDirection = 'desc';
  private filterQuery = '';
  private selectedPid: number | null = null;

  // ─── Process Management ──────────────────────────────────────────

  /** Add or update a process. */
  setProcess(info: ProcessInfo): void {
    this.processes.set(info.pid, info);
  }

  /** Remove a process. */
  removeProcess(pid: number): void {
    this.processes.delete(pid);
    if (this.selectedPid === pid) this.selectedPid = null;
  }

  /** Get a process by PID. */
  getProcess(pid: number): ProcessInfo | undefined {
    return this.processes.get(pid);
  }

  /** Get all processes. */
  getProcesses(): ProcessInfo[] {
    return [...this.processes.values()];
  }

  /** Get child processes. */
  getChildren(ppid: number): ProcessInfo[] {
    return [...this.processes.values()].filter((p) => p.ppid === ppid);
  }

  /** Get process tree roots (no parent or parent not in list). */
  getRoots(): ProcessInfo[] {
    return [...this.processes.values()].filter((p) => !p.ppid || !this.processes.has(p.ppid));
  }

  // ─── System Resources ────────────────────────────────────────────

  /** Update system resource info. */
  setSystemResources(resources: Partial<SystemResources>): void {
    this.system = { ...this.system, ...resources };
  }

  /** Get system resources. */
  getSystemResources(): SystemResources {
    return this.system;
  }

  // ─── Sorting & Filtering ─────────────────────────────────────────

  /** Set sort column. */
  setSort(column: SortColumn, direction?: SortDirection): void {
    if (this.sortColumn === column && !direction) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = direction ?? 'desc';
    }
  }

  /** Set filter query. */
  setFilter(query: string): void {
    this.filterQuery = query.toLowerCase();
  }

  /** Get sorted and filtered processes. */
  getSortedProcesses(): ProcessInfo[] {
    let procs = [...this.processes.values()];

    // Filter
    if (this.filterQuery) {
      procs = procs.filter((p) =>
        p.name.toLowerCase().includes(this.filterQuery) ||
        String(p.pid).includes(this.filterQuery) ||
        (p.user ?? '').toLowerCase().includes(this.filterQuery)
      );
    }

    // Sort
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    procs.sort((a, b) => {
      switch (this.sortColumn) {
        case 'pid': return (a.pid - b.pid) * dir;
        case 'name': return a.name.localeCompare(b.name) * dir;
        case 'cpu': return (a.cpu - b.cpu) * dir;
        case 'memory': return (a.memory - b.memory) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
        default: return 0;
      }
    });

    return procs;
  }

  // ─── Selection ───────────────────────────────────────────────────

  /** Select a process. */
  select(pid: number | null): void {
    this.selectedPid = pid;
  }

  /** Get selected PID. */
  getSelected(): number | null {
    return this.selectedPid;
  }

  /** Get top CPU consumer. */
  getTopConsumer(): ProcessInfo | null {
    let top: ProcessInfo | null = null;
    for (const p of this.processes.values()) {
      if (!top || p.cpu > top.cpu) top = p;
    }
    return top;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the process manager. */
  render(options: ProcessRenderOptions): string[] {
    const { width, height, showTree = false, showSummary = true, topN, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header with system summary
    const cpuStr = `CPU: ${boldFg(this.system.cpuUsage > 80 ? 'error' : 'text', `${Math.round(this.system.cpuUsage)}%`)}`;
    const memStr = `MEM: ${boldFg(this.system.memUsage > 80 ? 'error' : 'text', `${Math.round(this.system.memUsage)}%`)}`;
    const title = ` Processes`;
    const summary = showSummary ? ` ${cpuStr} ${memStr}` : '';
    lines.push(fg('textMuted', `┌─${boldFg('text', title)}${'─'.repeat(Math.max(0, innerWidth - title.length - 20))}${summary} ┐`));

    // Column headers
    const header = this.renderHeader(innerWidth, fg, boldFg, dimFg);
    lines.push(fg('textMuted', '│') + header + fg('textMuted', '│'));

    // Process list
    const contentHeight = height - 4;
    let procs: ProcessInfo[];

    if (showTree) {
      procs = this.getTreeOrder();
    } else {
      procs = this.getSortedProcesses();
    }

    if (topN) {
      procs = procs.slice(0, topN);
    }

    for (const proc of procs.slice(0, contentHeight)) {
      const line = this.renderProcess(proc, innerWidth, showTree, options);
      lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));
    }

    // Pad
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer
    const sortInfo = `sort:${this.sortColumn.toUpperCase()}${this.sortDirection === 'desc' ? '↓' : '↑'}`;
    const topProc = this.getTopConsumer();
    const topInfo = topProc ? `Top: ${topProc.name}` : '';
    const footer = ` ${fg('primary', '[k]ill')} ${fg('primary', '[r]efresh')} ${dimFg('textMuted', sortInfo)}  ${procs.length} processes | ${topInfo}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderHeader(width: number, fg: (t: string, s: string) => string, boldFg: (t: string, s: string) => string, dimFg: (t: string, s: string) => string): string {
    const sortMark = (col: SortColumn) => this.sortColumn === col ? (this.sortDirection === 'desc' ? '▼' : '▲') : ' ';
    const pid = boldFg('text', ` PID${sortMark('pid')}`);
    const name = boldFg('text', `NAME${sortMark('name')}`.padEnd(16));
    const cpu = boldFg('text', `CPU%${sortMark('cpu')}`);
    const mem = boldFg('text', `MEM%${sortMark('mem' as SortColumn)}`);
    const status = boldFg('text', `STATUS${sortMark('status')}`);
    const header = ` ${pid} ${name} ${cpu.padEnd(6)} ${mem.padEnd(6)} ${status}`;
    return padRight(dimFg('textMuted', header), width);
  }

  private renderProcess(proc: ProcessInfo, width: number, showTree: boolean, options: ProcessRenderOptions): string {
    const { fg, boldFg, dimFg } = options;
    const isSelected = proc.pid === this.selectedPid;
    const prefix = isSelected ? fg('primary', '▸') : ' ';

    // Tree indentation
    let treePrefix = '';
    if (showTree && proc.ppid && this.processes.has(proc.ppid)) {
      const siblings = this.getChildren(proc.ppid);
      const isLast = siblings[siblings.length - 1]?.pid === proc.pid;
      treePrefix = dimFg('textMuted', isLast ? '└─ ' : '├─ ');
    }

    const pid = String(proc.pid).padStart(5);
    const name = `${treePrefix}${proc.name}`.padEnd(16).slice(0, 16);
    const cpuBar = this.renderMiniBar(proc.cpu, 5);
    const cpuStr = proc.cpu.toFixed(1).padStart(5);
    const memStr = proc.memory.toFixed(1).padStart(5);
    const statusIcon = fg(STATUS_TOKENS[proc.status], STATUS_ICONS[proc.status]);
    const statusText = proc.status.padEnd(8);

    const nameStr = isSelected ? boldFg('text', name) : fg('text', name);
    const cpuColor = proc.cpu > 50 ? 'error' : proc.cpu > 20 ? 'warning' : 'text';
    const line = ` ${prefix} ${dimFg('textMuted', pid)} ${nameStr} ${cpuBar} ${fg(cpuColor, cpuStr)} ${fg('text', memStr)} ${statusIcon} ${dimFg('textMuted', statusText)}`;

    return padRight(line, width);
  }

  private renderMiniBar(value: number, width: number): string {
    const filled = Math.min(Math.round((value / 100) * width), width);
    const color = value > 50 ? '\x1b[31m' : value > 20 ? '\x1b[33m' : '\x1b[32m';
    return `${color}${'█'.repeat(filled)}${'░'.repeat(width - filled)}\x1b[0m`;
  }

  private getTreeOrder(): ProcessInfo[] {
    const result: ProcessInfo[] = [];
    const roots = this.getRoots().sort((a, b) => b.cpu - a.cpu);

    const visit = (proc: ProcessInfo, depth: number) => {
      result.push(proc);
      const children = this.getChildren(proc.pid).sort((a, b) => b.cpu - a.cpu);
      for (const child of children) {
        visit(child, depth + 1);
      }
    };

    for (const root of roots) {
      visit(root, 0);
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo process manager with sample data. */
export function createDemoProcessManager(): ProcessManager {
  const pm = new ProcessManager();

  pm.setSystemResources({
    cpuUsage: 45,
    memUsage: 62,
    memTotal: 16 * 1024 * 1024 * 1024,
    memUsed: 10 * 1024 * 1024 * 1024,
    loadAvg: [2.1, 1.8, 1.5],
    uptime: 86400 * 3,
  });

  pm.setProcess({ pid: 1, name: 'systemd', cpu: 0.1, memory: 0.5, status: 'sleeping', user: 'root' });
  pm.setProcess({ pid: 1024, name: 'node', cpu: 12.3, memory: 8.2, status: 'running', ppid: 1, user: 'dev' });
  pm.setProcess({ pid: 1025, name: 'worker', cpu: 5.1, memory: 3.4, status: 'running', ppid: 1024, user: 'dev' });
  pm.setProcess({ pid: 1026, name: 'worker', cpu: 2.8, memory: 2.1, status: 'sleeping', ppid: 1024, user: 'dev' });
  pm.setProcess({ pid: 2048, name: 'chrome', cpu: 28.4, memory: 24.5, status: 'running', ppid: 1, user: 'dev' });
  pm.setProcess({ pid: 2049, name: 'gpu-process', cpu: 8.2, memory: 6.1, status: 'running', ppid: 2048, user: 'dev' });
  pm.setProcess({ pid: 3072, name: 'vim', cpu: 0.1, memory: 1.2, status: 'sleeping', ppid: 1, user: 'dev' });
  pm.setProcess({ pid: 4096, name: 'defunct', cpu: 0, memory: 0, status: 'zombie', ppid: 1, user: 'dev' });

  return pm;
}
