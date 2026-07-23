/**
 * NetworkMonitor — real-time network traffic and latency visualization.
 *
 * Provides network monitoring UI:
 * - Real-time throughput graph (upload/download)
 * - Latency histogram with percentile markers
 * - Connection status indicators
 * - Host list with ping/latency
 * - Bandwidth usage bars
 * - Packet loss detection
 * - DNS resolution display
 * - Port scanning results
 * - Traffic alerts (threshold-based)
 * - Historical data ring buffer
 *
 * Visual style:
 * ┌─ Network Monitor ─────────────────────────────────┐
 * │ ↓ 12.4 MB/s  ↑ 2.1 MB/s   RTT: 23ms  Loss: 0%  │
 * │                                                   │
 * │ Download  ▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂▁▂▃▅▇  │
 * │ Upload    ▁▁▂▂▃▃▂▂▁▁▂▂▃▃▂▂▁▁▂▂▃▃▂▂▁▁▂▂▃▃▂▂▁▁▂  │
 * │                                                   │
 * │ Hosts:                                            │
 * │  ● google.com      14ms  ████████████████░░  OK   │
 * │  ● github.com      23ms  ██████████████░░░░  OK   │
 * │  ◐ slow.host.com  340ms  ████░░░░░░░░░░░░  SLOW  │
 * └───────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrafficSample {
  readonly timestamp: number;
  readonly download: number; // bytes/sec
  readonly upload: number; // bytes/sec
}

export interface LatencySample {
  readonly timestamp: number;
  readonly rtt: number; // ms
  readonly host: string;
}

export interface HostStatus {
  readonly host: string;
  readonly ip?: string;
  readonly latency: number; // ms
  readonly status: 'ok' | 'slow' | 'timeout' | 'unreachable';
  readonly packetLoss: number; // 0-1
  readonly lastPing: number;
}

export interface NetworkAlert {
  readonly id: string;
  readonly type: 'latency' | 'loss' | 'bandwidth' | 'disconnect';
  readonly severity: 'info' | 'warning' | 'critical';
  readonly message: string;
  readonly timestamp: number;
}

export interface NetworkRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showGraph?: boolean;
  readonly showHosts?: boolean;
  readonly showAlerts?: boolean;
  readonly graphWidth?: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// NetworkMonitor
// ---------------------------------------------------------------------------

const SPARK_CHARS = '▁▂▃▄▅▆▇█';
const MAX_SAMPLES = 60;

export class NetworkMonitor {
  private trafficHistory: TrafficSample[] = [];
  private latencyHistory: LatencySample[] = [];
  private hosts: Map<string, HostStatus> = new Map();
  private alerts: NetworkAlert[] = [];
  private alertCounter = 0;
  private thresholds = { latencyWarn: 100, latencyCrit: 300, lossWarn: 0.05, lossCrit: 0.2 };

  // ─── Traffic ─────────────────────────────────────────────────────

  /** Record a traffic sample. */
  recordTraffic(download: number, upload: number): void {
    this.trafficHistory.push({ timestamp: Date.now(), download, upload });
    if (this.trafficHistory.length > MAX_SAMPLES) {
      this.trafficHistory.shift();
    }
  }

  /** Get current throughput. */
  getCurrentThroughput(): { download: number; upload: number } {
    const last = this.trafficHistory[this.trafficHistory.length - 1];
    return { download: last?.download ?? 0, upload: last?.upload ?? 0 };
  }

  /** Get average throughput over window. */
  getAverageThroughput(windowMs = 10000): { download: number; upload: number } {
    const cutoff = Date.now() - windowMs;
    const samples = this.trafficHistory.filter((s) => s.timestamp >= cutoff);
    if (samples.length === 0) return { download: 0, upload: 0 };
    const totalDl = samples.reduce((sum, s) => sum + s.download, 0);
    const totalUl = samples.reduce((sum, s) => sum + s.upload, 0);
    return { download: totalDl / samples.length, upload: totalUl / samples.length };
  }

  /** Get peak throughput. */
  getPeakThroughput(): { download: number; upload: number } {
    let maxDl = 0;
    let maxUl = 0;
    for (const s of this.trafficHistory) {
      maxDl = Math.max(maxDl, s.download);
      maxUl = Math.max(maxUl, s.upload);
    }
    return { download: maxDl, upload: maxUl };
  }

  // ─── Latency ─────────────────────────────────────────────────────

  /** Record a latency measurement. */
  recordLatency(host: string, rtt: number): void {
    this.latencyHistory.push({ timestamp: Date.now(), rtt, host });
    if (this.latencyHistory.length > MAX_SAMPLES * 4) {
      this.latencyHistory.shift();
    }

    // Update host status
    const status: HostStatus['status'] = rtt > this.thresholds.latencyCrit ? 'timeout' : rtt > this.thresholds.latencyWarn ? 'slow' : 'ok';
    const existing = this.hosts.get(host);
    this.hosts.set(host, {
      host,
      latency: rtt,
      status,
      packetLoss: existing?.packetLoss ?? 0,
      lastPing: Date.now(),
    });

    // Check alert threshold
    if (rtt > this.thresholds.latencyCrit) {
      this.addAlert('latency', 'critical', `${host}: RTT ${Math.round(rtt)}ms exceeds critical threshold`);
    } else if (rtt > this.thresholds.latencyWarn) {
      this.addAlert('latency', 'warning', `${host}: RTT ${Math.round(rtt)}ms exceeds warning threshold`);
    }
  }

  /** Get latency percentiles. */
  getLatencyPercentiles(): { p50: number; p90: number; p99: number } {
    const rtts = this.latencyHistory.map((s) => s.rtt).sort((a, b) => a - b);
    if (rtts.length === 0) return { p50: 0, p90: 0, p99: 0 };
    const p50 = rtts[Math.floor(rtts.length * 0.5)] ?? 0;
    const p90 = rtts[Math.floor(rtts.length * 0.9)] ?? 0;
    const p99 = rtts[Math.floor(rtts.length * 0.99)] ?? 0;
    return { p50, p90, p99 };
  }

  // ─── Hosts ───────────────────────────────────────────────────────

  /** Add or update a host. */
  setHost(host: string, status: Partial<HostStatus>): void {
    const existing = this.hosts.get(host);
    this.hosts.set(host, {
      host,
      ip: status.ip ?? existing?.ip,
      latency: status.latency ?? existing?.latency ?? 0,
      status: status.status ?? existing?.status ?? 'ok',
      packetLoss: status.packetLoss ?? existing?.packetLoss ?? 0,
      lastPing: status.lastPing ?? Date.now(),
    });
  }

  /** Get all hosts. */
  getHosts(): HostStatus[] {
    return [...this.hosts.values()];
  }

  /** Set alert thresholds. */
  setThresholds(thresholds: Partial<typeof this.thresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  // ─── Alerts ──────────────────────────────────────────────────────

  private addAlert(type: NetworkAlert['type'], severity: NetworkAlert['severity'], message: string): void {
    // Dedup: skip if same message within 5s
    const recent = this.alerts.find((a) => a.message === message && Date.now() - a.timestamp < 5000);
    if (recent) return;

    this.alerts.push({ id: `alert-${String(++this.alertCounter)}`, type, severity, message, timestamp: Date.now() });
    if (this.alerts.length > 20) this.alerts.shift();
  }

  /** Get recent alerts. */
  getAlerts(limit = 5): NetworkAlert[] {
    return this.alerts.slice(-limit);
  }

  /** Clear alerts. */
  clearAlerts(): void {
    this.alerts = [];
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the network monitor UI. */
  render(options: NetworkRenderOptions): string[] {
    const { width, showGraph = true, showHosts = true, showAlerts = true, graphWidth = 30, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    // Header with current stats
    const { download, upload } = this.getCurrentThroughput();
    const { p50 } = this.getLatencyPercentiles();
    const avgLoss = this.hosts.size > 0
      ? [...this.hosts.values()].reduce((sum, h) => sum + h.packetLoss, 0) / this.hosts.size
      : 0;

    const header = ` ↓ ${boldFg('success', formatBytes(download) + '/s')}  ↑ ${boldFg('primary', formatBytes(upload) + '/s')}   RTT: ${boldFg('text', `${Math.round(p50)}ms`)}  Loss: ${avgLoss > 0.01 ? fg('error', `${(avgLoss * 100).toFixed(1)}%`) : fg('success', '0%')}`;
    lines.push(fg('textMuted', `┌─ ${boldFg('text', 'Network Monitor')} ${'─'.repeat(Math.max(0, width - 20))}┐`));
    lines.push(fg('textMuted', '│') + padRight(header, width - 2) + fg('textMuted', '│'));
    lines.push(fg('textMuted', '│' + ' '.repeat(width - 2) + '│'));

    // Traffic graph
    if (showGraph) {
      const dlSpark = this.renderSparkline(this.trafficHistory.map((s) => s.download), graphWidth);
      const ulSpark = this.renderSparkline(this.trafficHistory.map((s) => s.upload), graphWidth);
      lines.push(fg('textMuted', '│') + ` ${fg('success', 'Download')} ${dlSpark}` + ' '.repeat(Math.max(0, width - 14 - graphWidth)) + fg('textMuted', '│'));
      lines.push(fg('textMuted', '│') + ` ${fg('primary', 'Upload  ')} ${ulSpark}` + ' '.repeat(Math.max(0, width - 14 - graphWidth)) + fg('textMuted', '│'));
      lines.push(fg('textMuted', '│' + ' '.repeat(width - 2) + '│'));
    }

    // Host list
    if (showHosts && this.hosts.size > 0) {
      lines.push(fg('textMuted', '│') + ` ${boldFg('text', 'Hosts:')}` + ' '.repeat(width - 9) + fg('textMuted', '│'));
      const hostList = [...this.hosts.values()].sort((a, b) => a.latency - b.latency);
      for (const host of hostList.slice(0, 5)) {
        const icon = host.status === 'ok' ? fg('success', '●') : host.status === 'slow' ? fg('warning', '◐') : fg('error', '○');
        const latencyStr = `${String(Math.round(host.latency)).padStart(4)}ms`;
        const bar = this.renderLatencyBar(host.latency, 16);
        const statusLabel = host.status === 'ok' ? fg('success', ' OK ') : host.status === 'slow' ? fg('warning', 'SLOW') : fg('error', 'DOWN');
        const hostLine = `  ${icon} ${host.host.padEnd(16).slice(0, 16)} ${latencyStr}  ${bar} ${statusLabel}`;
        lines.push(fg('textMuted', '│') + padRight(hostLine, width - 2) + fg('textMuted', '│'));
      }
    }

    // Alerts
    if (showAlerts && this.alerts.length > 0) {
      lines.push(fg('textMuted', '│' + ' '.repeat(width - 2) + '│'));
      const recentAlerts = this.alerts.slice(-2);
      for (const alert of recentAlerts) {
        const icon = alert.severity === 'critical' ? fg('error', '⚠') : alert.severity === 'warning' ? fg('warning', '⚡') : fg('primary', 'ℹ');
        const alertLine = ` ${icon} ${alert.message.slice(0, width - 6)}`;
        lines.push(fg('textMuted', '│') + padRight(alertLine, width - 2) + fg('textMuted', '│'));
      }
    }

    lines.push(fg('textMuted', `└${'─'.repeat(width - 2)}┘`));
    return lines;
  }

  private renderSparkline(values: number[], width: number): string {
    if (values.length === 0) return '░'.repeat(width);
    const slice = values.slice(-width);
    const max = Math.max(...slice, 1);
    return slice.map((v) => {
      const idx = Math.min(Math.floor((v / max) * (SPARK_CHARS.length - 1)), SPARK_CHARS.length - 1);
      return SPARK_CHARS[idx] ?? '▁';
    }).join('');
  }

  private renderLatencyBar(latency: number, width: number): string {
    const maxLatency = 500;
    const filled = Math.min(Math.round((latency / maxLatency) * width), width);
    const color = latency > this.thresholds.latencyCrit ? 'error' : latency > this.thresholds.latencyWarn ? 'warning' : 'success';
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    return this.fgColor(color, bar);
  }

  private fgColor(token: string, text: string): string {
    // Inline helper for render context
    const colors: Record<string, string> = { success: '\x1b[32m', warning: '\x1b[33m', error: '\x1b[31m' };
    return `${colors[token] ?? ''}${text}\x1b[0m`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function padRight(str: string, len: number): string {
  // ANSI-aware padding
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo network monitor with sample data. */
export function createDemoMonitor(): NetworkMonitor {
  const monitor = new NetworkMonitor();

  // Simulate traffic history
  for (let i = 0; i < 30; i++) {
    const dl = 8_000_000 + Math.sin(i * 0.3) * 4_000_000 + Math.random() * 2_000_000;
    const ul = 1_500_000 + Math.sin(i * 0.5) * 800_000 + Math.random() * 500_000;
    monitor.recordTraffic(Math.max(0, dl), Math.max(0, ul));
  }

  // Add hosts
  monitor.setHost('google.com', { ip: '142.250.80.46', latency: 14, status: 'ok', packetLoss: 0 });
  monitor.setHost('github.com', { ip: '140.82.121.3', latency: 23, status: 'ok', packetLoss: 0 });
  monitor.setHost('api.openai.com', { ip: '104.18.6.192', latency: 45, status: 'ok', packetLoss: 0 });
  monitor.setHost('slow-cdn.example.com', { ip: '203.0.113.42', latency: 340, status: 'slow', packetLoss: 0.03 });

  // Record some latency
  monitor.recordLatency('google.com', 14);
  monitor.recordLatency('github.com', 23);
  monitor.recordLatency('api.openai.com', 45);
  monitor.recordLatency('slow-cdn.example.com', 340);

  return monitor;
}
