/**
 * PerformanceMonitor — real-time performance overlay for the TUI.
 *
 * Provides a transparent performance monitoring overlay:
 * - FPS counter with frame time histogram
 * - Memory usage (RSS, heap used/total) with trend
 * - Event loop lag detection (p50, p95, p99)
 * - Render pipeline timing (layout, paint, composite)
 * - GC pause detection
 * - Network latency (provider response times)
 * - Compact sparkline charts for each metric
 *
 * Display modes:
 * - Overlay: Semi-transparent corner overlay (toggle with keybind)
 * - Full: Dedicated panel with detailed breakdown
 * - Minimal: Single-line FPS + memory for status bar
 *
 * Performance budgets:
 * - Frame time: <16ms (60fps), <33ms (30fps)
 * - Event loop lag: <50ms healthy, <100ms warning, >100ms critical
 * - Memory: <512MB healthy, <1GB warning, >1GB critical
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PerfHealth = 'healthy' | 'warning' | 'critical';

export interface FrameMetrics {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly frameTimeP95: number;
  readonly droppedFrames: number;
  readonly totalFrames: number;
}

export interface MemoryMetrics {
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly externalBytes: number;
  readonly heapUsageRatio: number;
}

export interface EventLoopMetrics {
  readonly lagMs: number;
  readonly lagP50: number;
  readonly lagP95: number;
  readonly lagP99: number;
}

export interface RenderPipelineMetrics {
  readonly layoutMs: number;
  readonly paintMs: number;
  readonly compositeMs: number;
  readonly totalMs: number;
}

export interface PerfSnapshot {
  readonly timestamp: number;
  readonly frame: FrameMetrics;
  readonly memory: MemoryMetrics;
  readonly eventLoop: EventLoopMetrics;
  readonly render: RenderPipelineMetrics;
}

export interface PerfMonitorOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FPS_BUDGET_60 = 16.67; // ms per frame at 60fps
const FPS_BUDGET_30 = 33.33; // ms per frame at 30fps

const EVENT_LOOP_HEALTHY = 50; // ms
const EVENT_LOOP_WARNING = 100; // ms

const MEMORY_HEALTHY = 512 * 1024 * 1024; // 512MB
const MEMORY_WARNING = 1024 * 1024 * 1024; // 1GB

/** History buffer size for sparklines. */
const HISTORY_SIZE = 60;

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

// ---------------------------------------------------------------------------
// PerformanceMonitor
// ---------------------------------------------------------------------------

export class PerformanceMonitor {
  private frameTimes: number[] = [];
  private lagSamples: number[] = [];
  private fpsHistory: number[] = [];
  private memoryHistory: number[] = [];
  private lagHistory: number[] = [];
  private droppedFrames = 0;
  private totalFrames = 0;
  private lastFrameTime = 0;
  private lastLagCheck = 0;
  private renderPipeline: RenderPipelineMetrics = { layoutMs: 0, paintMs: 0, compositeMs: 0, totalMs: 0 };
  private visible = false;
  private mode: 'overlay' | 'full' | 'minimal' = 'overlay';

  // ─── Frame Tracking ───────────────────────────────────────────────

  /** Record a frame completion. Call at the end of each render cycle. */
  recordFrame(now: number = Date.now()): void {
    if (this.lastFrameTime > 0) {
      const frameTime = now - this.lastFrameTime;
      this.frameTimes.push(frameTime);
      if (this.frameTimes.length > HISTORY_SIZE) this.frameTimes.shift();

      this.totalFrames++;
      if (frameTime > FPS_BUDGET_60 * 2) {
        this.droppedFrames++;
      }

      // Update FPS history
      const fps = 1000 / frameTime;
      this.fpsHistory.push(fps);
      if (this.fpsHistory.length > HISTORY_SIZE) this.fpsHistory.shift();
    }
    this.lastFrameTime = now;
  }

  /** Record event loop lag measurement. */
  recordLag(lagMs: number): void {
    this.lagSamples.push(lagMs);
    if (this.lagSamples.length > HISTORY_SIZE) this.lagSamples.shift();

    this.lagHistory.push(lagMs);
    if (this.lagHistory.length > HISTORY_SIZE) this.lagHistory.shift();
  }

  /** Record render pipeline timing. */
  recordRenderPipeline(layoutMs: number, paintMs: number, compositeMs: number): void {
    this.renderPipeline = {
      layoutMs,
      paintMs,
      compositeMs,
      totalMs: layoutMs + paintMs + compositeMs,
    };
  }

  /** Record memory snapshot. */
  recordMemory(): void {
    const mem = process.memoryUsage();
    this.memoryHistory.push(mem.heapUsed);
    if (this.memoryHistory.length > HISTORY_SIZE) this.memoryHistory.shift();
  }

  // ─── Visibility Control ───────────────────────────────────────────

  toggle(): void {
    this.visible = !this.visible;
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setMode(mode: 'overlay' | 'full' | 'minimal'): void {
    this.mode = mode;
  }

  cycleMode(): void {
    const modes: Array<'overlay' | 'full' | 'minimal'> = ['overlay', 'full', 'minimal'];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length]!;
  }

  // ─── Metrics Computation ──────────────────────────────────────────

  getFrameMetrics(): FrameMetrics {
    if (this.frameTimes.length === 0) {
      return { fps: 0, frameTimeMs: 0, frameTimeP95: 0, droppedFrames: 0, totalFrames: 0 };
    }

    const recent = this.frameTimes.slice(-30);
    const avgFrameTime = recent.reduce((a, b) => a + b, 0) / recent.length;
    const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;

    // P95 frame time
    const sorted = [...recent].sort((a, b) => a - b);
    const p95Idx = Math.floor(sorted.length * 0.95);
    const frameTimeP95 = sorted[p95Idx] ?? sorted[sorted.length - 1] ?? 0;

    return {
      fps: Math.round(fps),
      frameTimeMs: Math.round(avgFrameTime * 10) / 10,
      frameTimeP95: Math.round(frameTimeP95 * 10) / 10,
      droppedFrames: this.droppedFrames,
      totalFrames: this.totalFrames,
    };
  }

  getMemoryMetrics(): MemoryMetrics {
    const mem = process.memoryUsage();
    return {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      heapUsageRatio: mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0,
    };
  }

  getEventLoopMetrics(): EventLoopMetrics {
    if (this.lagSamples.length === 0) {
      return { lagMs: 0, lagP50: 0, lagP95: 0, lagP99: 0 };
    }

    const sorted = [...this.lagSamples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    const current = this.lagSamples[this.lagSamples.length - 1] ?? 0;

    return { lagMs: current, lagP50: p50, lagP95: p95, lagP99: p99 };
  }

  getRenderMetrics(): RenderPipelineMetrics {
    return this.renderPipeline;
  }

  // ─── Health Assessment ────────────────────────────────────────────

  getFpsHealth(): PerfHealth {
    const { fps } = this.getFrameMetrics();
    if (fps >= 50) return 'healthy';
    if (fps >= 25) return 'warning';
    return 'critical';
  }

  getMemoryHealth(): PerfHealth {
    const { rssBytes } = this.getMemoryMetrics();
    if (rssBytes < MEMORY_HEALTHY) return 'healthy';
    if (rssBytes < MEMORY_WARNING) return 'warning';
    return 'critical';
  }

  getEventLoopHealth(): PerfHealth {
    const { lagP95 } = this.getEventLoopMetrics();
    if (lagP95 < EVENT_LOOP_HEALTHY) return 'healthy';
    if (lagP95 < EVENT_LOOP_WARNING) return 'warning';
    return 'critical';
  }

  getOverallHealth(): PerfHealth {
    const healths = [this.getFpsHealth(), this.getMemoryHealth(), this.getEventLoopHealth()];
    if (healths.includes('critical')) return 'critical';
    if (healths.includes('warning')) return 'warning';
    return 'healthy';
  }

  // ─── Rendering ────────────────────────────────────────────────────

  render(options: PerfMonitorOptions): string[] {
    if (!this.visible) return [];

    switch (this.mode) {
      case 'overlay': return this.renderOverlay(options);
      case 'full': return this.renderFull(options);
      case 'minimal': return this.renderMinimal(options);
    }
  }

  private renderOverlay(options: PerfMonitorOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const frame = this.getFrameMetrics();
    const memory = this.getMemoryMetrics();
    const eventLoop = this.getEventLoopMetrics();

    const fpsColor = healthColor(this.getFpsHealth());
    const memColor = healthColor(this.getMemoryHealth());
    const lagColor = healthColor(this.getEventLoopHealth());

    // FPS with sparkline
    const fpsSpark = renderSparkline(this.fpsHistory, 12, 0, 60);
    lines.push(`${fg(fpsColor, `${String(frame.fps).padStart(3)} fps`)} ${dimFg('textMuted', fpsSpark)} ${dimFg('textMuted', `${String(frame.frameTimeMs)}ms`)}`);

    // Memory
    const memMB = Math.round(memory.rssBytes / 1024 / 1024);
    const memSpark = renderSparkline(this.memoryHistory, 12, 0, MEMORY_WARNING);
    lines.push(`${fg(memColor, `${String(memMB).padStart(4)} MB`)} ${dimFg('textMuted', memSpark)} ${dimFg('textMuted', `heap ${String(Math.round(memory.heapUsageRatio * 100))}%`)}`);

    // Event loop lag
    const lagSpark = renderSparkline(this.lagHistory, 12, 0, EVENT_LOOP_WARNING * 2);
    lines.push(`${fg(lagColor, `${String(Math.round(eventLoop.lagMs)).padStart(4)} ms`)} ${dimFg('textMuted', lagSpark)} ${dimFg('textMuted', `p95 ${String(Math.round(eventLoop.lagP95))}ms`)}`);

    return lines;
  }

  private renderFull(options: PerfMonitorOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg } = options;
    const lines: string[] = [];
    const frame = this.getFrameMetrics();
    const memory = this.getMemoryMetrics();
    const eventLoop = this.getEventLoopMetrics();
    const render = this.getRenderMetrics();
    const overall = this.getOverallHealth();

    // Header
    const healthGlyph = overall === 'healthy' ? '●' : overall === 'warning' ? '◐' : '✗';
    const healthColorToken = overall === 'healthy' ? 'success' : overall === 'warning' ? 'warning' : 'error';
    lines.push(boldFg('text', ` Performance ${fg(healthColorToken, healthGlyph)} ${dimFg('textMuted', `[${this.mode}]`)}`));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    // FPS section
    lines.push(boldFg('text', ' Frames'));
    const fpsHealth = this.getFpsHealth();
    lines.push(`  FPS: ${fg(healthColor(fpsHealth), String(frame.fps))} ${dimFg('textMuted', `(target: 60)`)}`);
    lines.push(`  Frame time: ${String(frame.frameTimeMs)}ms ${dimFg('textMuted', `p95: ${String(frame.frameTimeP95)}ms`)}`);
    lines.push(`  Dropped: ${frame.droppedFrames > 0 ? fg('warning', String(frame.droppedFrames)) : dimFg('textMuted', '0')} ${dimFg('textMuted', `/ ${String(frame.totalFrames)} total`)}`);
    lines.push(`  ${renderSparkline(this.fpsHistory, Math.min(width - 6, 40), 0, 60)}`);

    // Memory section
    lines.push('');
    lines.push(boldFg('text', ' Memory'));
    const memHealth = this.getMemoryHealth();
    lines.push(`  RSS: ${fg(healthColor(memHealth), formatBytes(memory.rssBytes))}`);
    lines.push(`  Heap: ${formatBytes(memory.heapUsedBytes)} / ${formatBytes(memory.heapTotalBytes)} (${String(Math.round(memory.heapUsageRatio * 100))}%)`);
    lines.push(`  External: ${formatBytes(memory.externalBytes)}`);
    lines.push(`  ${renderSparkline(this.memoryHistory, Math.min(width - 6, 40), 0, MEMORY_WARNING)}`);

    // Event loop section
    lines.push('');
    lines.push(boldFg('text', ' Event Loop'));
    const lagHealth = this.getEventLoopHealth();
    lines.push(`  Lag: ${fg(healthColor(lagHealth), `${String(Math.round(eventLoop.lagMs))}ms`)}`);
    lines.push(`  p50: ${String(Math.round(eventLoop.lagP50))}ms  p95: ${String(Math.round(eventLoop.lagP95))}ms  p99: ${String(Math.round(eventLoop.lagP99))}ms`);
    lines.push(`  ${renderSparkline(this.lagHistory, Math.min(width - 6, 40), 0, EVENT_LOOP_WARNING * 2)}`);

    // Render pipeline section
    lines.push('');
    lines.push(boldFg('text', ' Render Pipeline'));
    const pipelineTotal = render.totalMs;
    const budget = FPS_BUDGET_60;
    const pipelineColor = pipelineTotal < budget ? 'success' : pipelineTotal < budget * 2 ? 'warning' : 'error';
    lines.push(`  Layout: ${String(render.layoutMs.toFixed(1))}ms  Paint: ${String(render.paintMs.toFixed(1))}ms  Composite: ${String(render.compositeMs.toFixed(1))}ms`);
    lines.push(`  Total: ${fg(pipelineColor, `${String(pipelineTotal.toFixed(1))}ms`)} ${dimFg('textMuted', `/ ${String(budget.toFixed(1))}ms budget`)}`);

    // Pipeline bar
    const barW = Math.min(width - 8, 30);
    const layoutW = pipelineTotal > 0 ? Math.round((render.layoutMs / pipelineTotal) * barW) : 0;
    const paintW = pipelineTotal > 0 ? Math.round((render.paintMs / pipelineTotal) * barW) : 0;
    const compositeW = Math.max(0, barW - layoutW - paintW);
    lines.push(`  ${fg('primary', '█'.repeat(layoutW))}${fg('accent', '█'.repeat(paintW))}${fg('success', '█'.repeat(compositeW))}`);
    lines.push(dimFg('textMuted', '  ■ Layout  ■ Paint  ■ Composite'));

    return lines.slice(0, height);
  }

  private renderMinimal(options: PerfMonitorOptions): string[] {
    const { fg, dimFg } = options;
    const frame = this.getFrameMetrics();
    const memory = this.getMemoryMetrics();

    const fpsColor = healthColor(this.getFpsHealth());
    const memMB = Math.round(memory.rssBytes / 1024 / 1024);
    const memColor = healthColor(this.getMemoryHealth());

    return [
      `${fg(fpsColor, `${String(frame.fps)}fps`)} ${fg(memColor, `${String(memMB)}MB`)}`,
    ];
  }

  // ─── Reset ────────────────────────────────────────────────────────

  reset(): void {
    this.frameTimes = [];
    this.lagSamples = [];
    this.fpsHistory = [];
    this.memoryHistory = [];
    this.lagHistory = [];
    this.droppedFrames = 0;
    this.totalFrames = 0;
    this.lastFrameTime = 0;
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

function healthColor(health: PerfHealth): string {
  switch (health) {
    case 'healthy': return 'success';
    case 'warning': return 'warning';
    case 'critical': return 'error';
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${String(bytes)}B`;
}

function renderSparkline(data: number[], width: number, min: number, max: number): string {
  if (data.length === 0) return '·'.repeat(width);

  const values = data.slice(-width);
  const range = max - min || 1;

  return values.map((v) => {
    const normalized = Math.max(0, Math.min(1, (v - min) / range));
    const idx = Math.min(SPARK_CHARS.length - 1, Math.floor(normalized * SPARK_CHARS.length));
    return SPARK_CHARS[idx] ?? '▁';
  }).join('');
}
