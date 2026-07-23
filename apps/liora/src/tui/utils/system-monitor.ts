/**
 * SystemMonitor — real-time CPU, memory, and disk monitoring.
 *
 * Provides system resource monitoring UI:
 * - CPU usage per core with history sparklines
 * - Memory usage (used/cached/buffers)
 * - Disk I/O (read/write speeds)
 * - Disk space usage per mount
 * - Network throughput (in/out)
 * - Temperature sensors
 * - Load average
 * - Uptime
 * - Top processes by resource
 * - Alert thresholds
 *
 * Visual style:
 * ┌─ System Monitor ──────────── up 3d 14h ──────────┐
 * │ CPU  [████████░░░░░░░░░░░░] 45%  Load: 2.1      │
 * │  Core0 ████████░░  Core1 ██████░░░░             │
 * │  Core2 ███░░░░░░░  Core3 █████████░             │
 * │                                                  │
 * │ MEM  [████████████░░░░░░░░] 62%  9.9G/16G       │
 * │  Used: 8.2G  Cached: 1.5G  Buffers: 0.2G        │
 * │                                                  │
 * │ DISK /     [██████████████░░░░░░] 72%  360G/500G │
 * │      /home [████░░░░░░░░░░░░░░░░] 22%  220G/1T   │
 * │                                                  │
 * │ NET  ↓ 12.4 MB/s  ↑ 2.1 MB/s   Temp: 52°C      │
 * └──────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CpuStats {
  readonly usage: number; // 0-100
  readonly perCore: number[];
  readonly loadAvg: [number, number, number];
  readonly temperature?: number;
}

export interface MemoryStats {
  readonly total: number;
  readonly used: number;
  readonly cached: number;
  readonly buffers: number;
  readonly swapTotal: number;
  readonly swapUsed: number;
}

export interface DiskStats {
  readonly mount: string;
  readonly total: number;
  readonly used: number;
  readonly readSpeed: number; // bytes/sec
  readonly writeSpeed: number; // bytes/sec
}

export interface NetworkStats {
  readonly interface: string;
  readonly rxBytes: number; // bytes/sec
  readonly txBytes: number; // bytes/sec
}

export interface SystemRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showCpuCores?: boolean;
  readonly showDisks?: boolean;
  readonly showNetwork?: boolean;
  readonly barWidth?: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// SystemMonitor
// ---------------------------------------------------------------------------

const BAR_CHARS = { filled: '█', empty: '░', half: '▓' };

export class SystemMonitor {
  private cpu: CpuStats = { usage: 0, perCore: [], loadAvg: [0, 0, 0] };
  private memory: MemoryStats = { total: 0, used: 0, cached: 0, buffers: 0, swapTotal: 0, swapUsed: 0 };
  private disks: DiskStats[] = [];
  private networks: NetworkStats[] = [];
  private uptime = 0;
  private cpuHistory: number[] = [];
  private memHistory: number[] = [];

  // ─── Updates ─────────────────────────────────────────────────────

  /** Update CPU stats. */
  setCpu(stats: CpuStats): void {
    this.cpu = stats;
    this.cpuHistory.push(stats.usage);
    if (this.cpuHistory.length > 60) this.cpuHistory.shift();
  }

  /** Update memory stats. */
  setMemory(stats: MemoryStats): void {
    this.memory = stats;
    const usage = stats.total > 0 ? (stats.used / stats.total) * 100 : 0;
    this.memHistory.push(usage);
    if (this.memHistory.length > 60) this.memHistory.shift();
  }

  /** Update disk stats. */
  setDisks(disks: DiskStats[]): void {
    this.disks = disks;
  }

  /** Update network stats. */
  setNetworks(networks: NetworkStats[]): void {
    this.networks = networks;
  }

  /** Set uptime in seconds. */
  setUptime(seconds: number): void {
    this.uptime = seconds;
  }

  // ─── Getters ─────────────────────────────────────────────────────

  getCpu(): CpuStats {
    return this.cpu;
  }

  getMemory(): MemoryStats {
    return this.memory;
  }

  getDisks(): DiskStats[] {
    return this.disks;
  }

  getNetworks(): NetworkStats[] {
    return this.networks;
  }

  getUptime(): number {
    return this.uptime;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the system monitor. */
  render(options: SystemRenderOptions): string[] {
    const { width, height, showCpuCores = true, showDisks = true, showNetwork = true, barWidth = 20, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header with uptime
    const uptimeStr = formatUptime(this.uptime);
    const title = ` System Monitor`;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)} ${'─'.repeat(Math.max(0, innerWidth - title.length - uptimeStr.length - 10))} ${dimFg('textMuted', `up ${uptimeStr}`)} ┐`));

    // CPU section
    const cpuColor = this.cpu.usage > 80 ? 'error' : this.cpu.usage > 50 ? 'warning' : 'success';
    const cpuBar = this.renderBar(this.cpu.usage, barWidth, cpuColor);
    const loadStr = `Load: ${this.cpu.loadAvg.map((l) => l.toFixed(1)).join(' ')}`;
    lines.push(fg('textMuted', '│') + ` ${boldFg('text', 'CPU')}  ${cpuBar} ${fg(cpuColor, `${Math.round(this.cpu.usage)}%`.padStart(4))}  ${dimFg('textMuted', loadStr)}` + ' '.repeat(Math.max(0, innerWidth - 45)) + fg('textMuted', '│'));

    // Per-core usage
    if (showCpuCores && this.cpu.perCore.length > 0) {
      const coresPerLine = 2;
      for (let i = 0; i < this.cpu.perCore.length; i += coresPerLine) {
        let coreLine = '  ';
        for (let j = 0; j < coresPerLine && i + j < this.cpu.perCore.length; j++) {
          const coreUsage = this.cpu.perCore[i + j]!;
          const coreColor = coreUsage > 80 ? 'error' : coreUsage > 50 ? 'warning' : 'primary';
          const miniBar = this.renderBar(coreUsage, 10, coreColor);
          coreLine += `${dimFg('textMuted', `Core${String(i + j)}`)} ${miniBar}  `;
        }
        lines.push(fg('textMuted', '│') + padRight(coreLine, innerWidth) + fg('textMuted', '│'));
      }
    }

    lines.push(fg('textMuted', '│' + ' '.repeat(innerWidth) + '│'));

    // Memory section
    const memUsage = this.memory.total > 0 ? (this.memory.used / this.memory.total) * 100 : 0;
    const memColor = memUsage > 85 ? 'error' : memUsage > 60 ? 'warning' : 'success';
    const memBar = this.renderBar(memUsage, barWidth, memColor);
    const memInfo = `${formatBytes(this.memory.used)}/${formatBytes(this.memory.total)}`;
    lines.push(fg('textMuted', '│') + ` ${boldFg('text', 'MEM')}  ${memBar} ${fg(memColor, `${Math.round(memUsage)}%`.padStart(4))}  ${dimFg('textMuted', memInfo)}` + ' '.repeat(Math.max(0, innerWidth - 45)) + fg('textMuted', '│'));

    // Memory breakdown
    const memBreakdown = `Used: ${formatBytes(this.memory.used)}  Cached: ${formatBytes(this.memory.cached)}  Buffers: ${formatBytes(this.memory.buffers)}`;
    lines.push(fg('textMuted', '│') + `  ${dimFg('textMuted', memBreakdown.slice(0, innerWidth - 4))}` + ' '.repeat(Math.max(0, innerWidth - 4 - memBreakdown.length)) + fg('textMuted', '│'));

    lines.push(fg('textMuted', '│' + ' '.repeat(innerWidth) + '│'));

    // Disk section
    if (showDisks && this.disks.length > 0) {
      for (const disk of this.disks.slice(0, 3)) {
        const diskUsage = disk.total > 0 ? (disk.used / disk.total) * 100 : 0;
        const diskColor = diskUsage > 90 ? 'error' : diskUsage > 70 ? 'warning' : 'primary';
        const diskBar = this.renderBar(diskUsage, barWidth - 4, diskColor);
        const diskInfo = `${formatBytes(disk.used)}/${formatBytes(disk.total)}`;
        const mountStr = disk.mount.padEnd(6).slice(0, 6);
        lines.push(fg('textMuted', '│') + ` ${boldFg('text', 'DISK')} ${dimFg('textMuted', mountStr)} ${diskBar} ${fg(diskColor, `${Math.round(diskUsage)}%`.padStart(4))} ${dimFg('textMuted', diskInfo)}` + ' '.repeat(Math.max(0, innerWidth - 50)) + fg('textMuted', '│'));
      }
      lines.push(fg('textMuted', '│' + ' '.repeat(innerWidth) + '│'));
    }

    // Network section
    if (showNetwork && this.networks.length > 0) {
      const net = this.networks[0]!;
      const tempStr = this.cpu.temperature ? `  Temp: ${fg(this.cpu.temperature > 70 ? 'error' : 'text', `${String(Math.round(this.cpu.temperature))}°C`)}` : '';
      const netLine = ` ${boldFg('text', 'NET')}  ${fg('success', '↓')} ${formatBytes(net.rxBytes)}/s  ${fg('primary', '↑')} ${formatBytes(net.txBytes)}/s${tempStr}`;
      lines.push(fg('textMuted', '│') + padRight(netLine, innerWidth) + fg('textMuted', '│'));
    }

    // Pad
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    lines.push(fg('textMuted', `└${'─'.repeat(innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderBar(percentage: number, width: number, colorToken: string): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    const colors: Record<string, string> = {
      success: '\x1b[32m', warning: '\x1b[33m', error: '\x1b[31m', primary: '\x1b[36m',
    };
    const color = colors[colorToken] ?? '';
    return `${color}${BAR_CHARS.filled.repeat(filled)}\x1b[0m${BAR_CHARS.empty.repeat(empty)}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)}G`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${Math.round(bytes)}B`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(mins)}m`;
  return `${String(mins)}m`;
}

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo system monitor with sample data. */
export function createDemoSystemMonitor(): SystemMonitor {
  const monitor = new SystemMonitor();

  monitor.setCpu({
    usage: 45,
    perCore: [78, 62, 28, 85],
    loadAvg: [2.1, 1.8, 1.5],
    temperature: 52,
  });

  monitor.setMemory({
    total: 16 * 1024 * 1024 * 1024,
    used: 9.9 * 1024 * 1024 * 1024,
    cached: 1.5 * 1024 * 1024 * 1024,
    buffers: 0.2 * 1024 * 1024 * 1024,
    swapTotal: 4 * 1024 * 1024 * 1024,
    swapUsed: 0.5 * 1024 * 1024 * 1024,
  });

  monitor.setDisks([
    { mount: '/', total: 500 * 1024 * 1024 * 1024, used: 360 * 1024 * 1024 * 1024, readSpeed: 120 * 1024 * 1024, writeSpeed: 45 * 1024 * 1024 },
    { mount: '/home', total: 1024 * 1024 * 1024 * 1024, used: 220 * 1024 * 1024 * 1024, readSpeed: 80 * 1024 * 1024, writeSpeed: 30 * 1024 * 1024 },
  ]);

  monitor.setNetworks([
    { interface: 'eth0', rxBytes: 12.4 * 1024 * 1024, txBytes: 2.1 * 1024 * 1024 },
  ]);

  monitor.setUptime(3 * 86400 + 14 * 3600 + 22 * 60);

  return monitor;
}
