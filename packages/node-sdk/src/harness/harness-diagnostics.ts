/**
 * HarnessDiagnostics — self-monitoring and auto-recovery for the agent harness.
 *
 * Provides continuous health monitoring of:
 * - Session liveness (heartbeat detection, stall recovery)
 * - Memory pressure (heap usage, GC pause detection)
 * - Provider connectivity (latency, error rates, circuit breaker)
 * - Context budget (token usage trajectory, compaction needs)
 * - Event loop health (lag detection, starvation warnings)
 *
 * Auto-recovery actions:
 * - Restart stalled sessions
 * - Trigger compaction when context pressure is critical
 * - Circuit-break failing providers and failover
 * - Emit structured diagnostic events for TUI display
 *
 * Design: zero-dependency, pure logic + callbacks. The harness wires in
 * actual implementations via the DiagnosticCallbacks interface.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

export type DiagnosticCategory =
  | 'session'
  | 'memory'
  | 'provider'
  | 'context'
  | 'event-loop'
  | 'recovery';

export interface DiagnosticEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly severity: DiagnosticSeverity;
  readonly category: DiagnosticCategory;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  /** Whether auto-recovery was attempted. */
  readonly recovered: boolean;
}

export interface HealthSnapshot {
  readonly timestamp: number;
  readonly overallGrade: 'healthy' | 'degraded' | 'critical';
  readonly sessionHealth: SessionHealth;
  readonly memoryHealth: MemoryHealth;
  readonly providerHealth: ProviderHealth;
  readonly contextHealth: ContextHealth;
  readonly eventLoopHealth: EventLoopHealth;
  readonly recentEvents: readonly DiagnosticEvent[];
}

export interface SessionHealth {
  readonly activeSessions: number;
  readonly stalledSessions: number;
  readonly lastActivityMs: number;
  readonly grade: 'healthy' | 'degraded' | 'critical';
}

export interface MemoryHealth {
  readonly heapUsedMb: number;
  readonly heapTotalMb: number;
  readonly externalMb: number;
  readonly usageRatio: number;
  readonly grade: 'healthy' | 'degraded' | 'critical';
}

export interface ProviderHealth {
  readonly provider: string;
  readonly latencyMs: number;
  readonly errorRate: number;
  readonly circuitState: 'closed' | 'half-open' | 'open';
  readonly grade: 'healthy' | 'degraded' | 'critical';
}

export interface ContextHealth {
  readonly tokenUsageRatio: number;
  readonly compactionCount: number;
  readonly lastCompactionMs: number;
  readonly trajectory: 'stable' | 'rising' | 'critical';
  readonly grade: 'healthy' | 'degraded' | 'critical';
}

export interface EventLoopHealth {
  readonly lagMs: number;
  readonly avgLagMs: number;
  readonly maxLagMs: number;
  readonly grade: 'healthy' | 'degraded' | 'critical';
}

export interface DiagnosticCallbacks {
  /** Get current session activity timestamps. */
  getSessionActivity(): Array<{ id: string; lastActivityMs: number }>;
  /** Get current token usage ratio (0-1). */
  getContextUsageRatio(): number;
  /** Get the current provider id. */
  getCurrentProvider(): string;
  /** Trigger compaction for a session. */
  triggerCompaction(sessionId: string): Promise<boolean>;
  /** Restart a stalled session. */
  restartSession(sessionId: string): Promise<boolean>;
  /** Emit a diagnostic event to the TUI/log. */
  emitEvent(event: DiagnosticEvent): void;
}

export interface DiagnosticOptions {
  /** Check interval in ms. Default: 5000. */
  readonly intervalMs?: number;
  /** Session stall threshold in ms. Default: 60000. */
  readonly stallThresholdMs?: number;
  /** Memory usage warning threshold (0-1). Default: 0.8. */
  readonly memoryWarningRatio?: number;
  /** Memory usage critical threshold (0-1). Default: 0.92. */
  readonly memoryCriticalRatio?: number;
  /** Event loop lag warning threshold in ms. Default: 100. */
  readonly lagWarningMs?: number;
  /** Event loop lag critical threshold in ms. Default: 500. */
  readonly lagCriticalMs?: number;
  /** Context usage warning threshold. Default: 0.75. */
  readonly contextWarningRatio?: number;
  /** Context usage critical threshold. Default: 0.9. */
  readonly contextCriticalRatio?: number;
  /** Provider error rate threshold for circuit break. Default: 0.5. */
  readonly providerErrorThreshold?: number;
  /** Max diagnostic events to retain. Default: 50. */
  readonly maxEvents?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_STALL_THRESHOLD_MS = 60_000;
const DEFAULT_MEMORY_WARNING = 0.8;
const DEFAULT_MEMORY_CRITICAL = 0.92;
const DEFAULT_LAG_WARNING_MS = 100;
const DEFAULT_LAG_CRITICAL_MS = 500;
const DEFAULT_CONTEXT_WARNING = 0.75;
const DEFAULT_CONTEXT_CRITICAL = 0.9;
const DEFAULT_PROVIDER_ERROR_THRESHOLD = 0.5;
const DEFAULT_MAX_EVENTS = 50;

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  state: 'closed' | 'half-open' | 'open';
  failures: number;
  lastFailureMs: number;
  openedAtMs: number;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RECOVERY_MS = 30_000;

// ---------------------------------------------------------------------------
// HarnessDiagnostics
// ---------------------------------------------------------------------------

export class HarnessDiagnostics {
  private readonly callbacks: DiagnosticCallbacks;
  private readonly options: Required<DiagnosticOptions>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private events: DiagnosticEvent[] = [];
  private eventCounter = 0;
  private running = false;

  // Event loop monitoring
  private lastTickMs = 0;
  private lagSamples: number[] = [];
  private readonly maxLagSamples = 20;

  // Provider circuit breaker
  private circuit: CircuitBreakerState = {
    state: 'closed',
    failures: 0,
    lastFailureMs: 0,
    openedAtMs: 0,
  };

  // Context trajectory tracking
  private contextHistory: Array<{ ratio: number; atMs: number }> = [];
  private compactionCount = 0;
  private lastCompactionMs = 0;

  constructor(callbacks: DiagnosticCallbacks, options?: DiagnosticOptions) {
    this.callbacks = callbacks;
    this.options = {
      intervalMs: options?.intervalMs ?? DEFAULT_INTERVAL_MS,
      stallThresholdMs: options?.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS,
      memoryWarningRatio: options?.memoryWarningRatio ?? DEFAULT_MEMORY_WARNING,
      memoryCriticalRatio: options?.memoryCriticalRatio ?? DEFAULT_MEMORY_CRITICAL,
      lagWarningMs: options?.lagWarningMs ?? DEFAULT_LAG_WARNING_MS,
      lagCriticalMs: options?.lagCriticalMs ?? DEFAULT_LAG_CRITICAL_MS,
      contextWarningRatio: options?.contextWarningRatio ?? DEFAULT_CONTEXT_WARNING,
      contextCriticalRatio: options?.contextCriticalRatio ?? DEFAULT_CONTEXT_CRITICAL,
      providerErrorThreshold: options?.providerErrorThreshold ?? DEFAULT_PROVIDER_ERROR_THRESHOLD,
      maxEvents: options?.maxEvents ?? DEFAULT_MAX_EVENTS,
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickMs = Date.now();
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
    this.emit('info', 'recovery', 'DIAG_START', 'Diagnostics monitor started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ─── External Signals ─────────────────────────────────────────────────

  /** Report a provider request completion (for circuit breaker). */
  reportProviderResult(success: boolean, latencyMs: number): void {
    if (success) {
      if (this.circuit.state === 'half-open') {
        this.circuit = { state: 'closed', failures: 0, lastFailureMs: 0, openedAtMs: 0 };
        this.emit('info', 'provider', 'CIRCUIT_CLOSED', 'Provider circuit breaker closed (recovered)');
      }
      this.circuit.failures = Math.max(0, this.circuit.failures - 1);
    } else {
      this.circuit.failures++;
      this.circuit.lastFailureMs = Date.now();
      if (this.circuit.failures >= CIRCUIT_FAILURE_THRESHOLD && this.circuit.state === 'closed') {
        this.circuit.state = 'open';
        this.circuit.openedAtMs = Date.now();
        this.emit('critical', 'provider', 'CIRCUIT_OPEN',
          `Provider circuit breaker opened after ${String(this.circuit.failures)} failures`);
      }
    }
    void latencyMs; // Tracked for future latency-based decisions
  }

  /** Report a compaction event. */
  reportCompaction(): void {
    this.compactionCount++;
    this.lastCompactionMs = Date.now();
  }

  // ─── Health Snapshot ──────────────────────────────────────────────────

  snapshot(): HealthSnapshot {
    const now = Date.now();
    const sessionHealth = this.assessSessionHealth(now);
    const memoryHealth = this.assessMemoryHealth();
    const providerHealth = this.assessProviderHealth(now);
    const contextHealth = this.assessContextHealth(now);
    const eventLoopHealth = this.assessEventLoopHealth();

    const grades = [
      sessionHealth.grade,
      memoryHealth.grade,
      providerHealth.grade,
      contextHealth.grade,
      eventLoopHealth.grade,
    ];
    const overallGrade = grades.includes('critical')
      ? 'critical'
      : grades.includes('degraded')
        ? 'degraded'
        : 'healthy';

    return {
      timestamp: now,
      overallGrade,
      sessionHealth,
      memoryHealth,
      providerHealth,
      contextHealth,
      eventLoopHealth,
      recentEvents: this.events.slice(-10),
    };
  }

  // ─── Internal: Tick ─────────────────────────────────────────────────

  private tick(): void {
    const now = Date.now();

    // Event loop lag measurement
    const expectedInterval = this.options.intervalMs;
    const actualDelta = now - this.lastTickMs;
    const lag = Math.max(0, actualDelta - expectedInterval);
    this.lagSamples.push(lag);
    if (this.lagSamples.length > this.maxLagSamples) {
      this.lagSamples.shift();
    }
    this.lastTickMs = now;

    // Run checks
    this.checkSessionStalls(now);
    this.checkMemoryPressure();
    this.checkContextPressure(now);
    this.checkEventLoopLag(lag);
    this.checkCircuitBreaker(now);
  }

  // ─── Checks ─────────────────────────────────────────────────────────

  private checkSessionStalls(now: number): void {
    const sessions = this.callbacks.getSessionActivity();
    for (const session of sessions) {
      const idle = now - session.lastActivityMs;
      if (idle > this.options.stallThresholdMs) {
        this.emit('warning', 'session', 'SESSION_STALL',
          `Session ${session.id.slice(0, 8)} stalled for ${formatDuration(idle)}`,
          { sessionId: session.id, idleMs: idle });
        // Attempt recovery
        void this.callbacks.restartSession(session.id).then((ok) => {
          if (ok) {
            this.emit('info', 'recovery', 'SESSION_RESTARTED',
              `Session ${session.id.slice(0, 8)} auto-restarted`, { sessionId: session.id });
          }
        });
      }
    }
  }

  private checkMemoryPressure(): void {
    const mem = process.memoryUsage();
    const ratio = mem.heapUsed / mem.heapTotal;
    if (ratio > this.options.memoryCriticalRatio) {
      this.emit('critical', 'memory', 'MEMORY_CRITICAL',
        `Heap usage critical: ${(ratio * 100).toFixed(1)}%`,
        { heapUsedMb: mem.heapUsed / 1048576, heapTotalMb: mem.heapTotal / 1048576 });
      // Suggest GC if available
      if (typeof globalThis.gc === 'function') {
        globalThis.gc();
        this.emit('info', 'recovery', 'GC_FORCED', 'Forced garbage collection triggered');
      }
    } else if (ratio > this.options.memoryWarningRatio) {
      this.emit('warning', 'memory', 'MEMORY_WARNING',
        `Heap usage elevated: ${(ratio * 100).toFixed(1)}%`);
    }
  }

  private checkContextPressure(now: number): void {
    const ratio = this.callbacks.getContextUsageRatio();
    this.contextHistory.push({ ratio, atMs: now });
    if (this.contextHistory.length > 30) {
      this.contextHistory.shift();
    }

    if (ratio > this.options.contextCriticalRatio) {
      this.emit('critical', 'context', 'CONTEXT_CRITICAL',
        `Context usage critical: ${(ratio * 100).toFixed(1)}%`);
      // Auto-compact
      const sessions = this.callbacks.getSessionActivity();
      if (sessions.length > 0) {
        void this.callbacks.triggerCompaction(sessions[0]!.id).then((ok) => {
          if (ok) this.reportCompaction();
        });
      }
    } else if (ratio > this.options.contextWarningRatio) {
      this.emit('warning', 'context', 'CONTEXT_WARNING',
        `Context usage elevated: ${(ratio * 100).toFixed(1)}%`);
    }
  }

  private checkEventLoopLag(lag: number): void {
    if (lag > this.options.lagCriticalMs) {
      this.emit('critical', 'event-loop', 'LAG_CRITICAL',
        `Event loop lag critical: ${String(Math.round(lag))}ms`);
    } else if (lag > this.options.lagWarningMs) {
      this.emit('warning', 'event-loop', 'LAG_WARNING',
        `Event loop lag elevated: ${String(Math.round(lag))}ms`);
    }
  }

  private checkCircuitBreaker(now: number): void {
    if (this.circuit.state === 'open') {
      const elapsed = now - this.circuit.openedAtMs;
      if (elapsed > CIRCUIT_RECOVERY_MS) {
        this.circuit.state = 'half-open';
        this.emit('info', 'provider', 'CIRCUIT_HALF_OPEN',
          'Provider circuit breaker half-open (testing recovery)');
      }
    }
  }

  // ─── Assessment ─────────────────────────────────────────────────────

  private assessSessionHealth(now: number): SessionHealth {
    const sessions = this.callbacks.getSessionActivity();
    const stalled = sessions.filter(
      (s) => now - s.lastActivityMs > this.options.stallThresholdMs,
    ).length;
    const lastActivity = sessions.length > 0
      ? Math.max(...sessions.map((s) => s.lastActivityMs))
      : 0;

    const grade = stalled > 0 ? 'critical' : sessions.length === 0 ? 'degraded' : 'healthy';
    return {
      activeSessions: sessions.length,
      stalledSessions: stalled,
      lastActivityMs: lastActivity > 0 ? now - lastActivity : -1,
      grade,
    };
  }

  private assessMemoryHealth(): MemoryHealth {
    const mem = process.memoryUsage();
    const ratio = mem.heapUsed / mem.heapTotal;
    const grade = ratio > this.options.memoryCriticalRatio
      ? 'critical'
      : ratio > this.options.memoryWarningRatio
        ? 'degraded'
        : 'healthy';
    return {
      heapUsedMb: mem.heapUsed / 1048576,
      heapTotalMb: mem.heapTotal / 1048576,
      externalMb: mem.external / 1048576,
      usageRatio: ratio,
      grade,
    };
  }

  private assessProviderHealth(now: number): ProviderHealth {
    const provider = this.callbacks.getCurrentProvider();
    const grade = this.circuit.state === 'open'
      ? 'critical'
      : this.circuit.state === 'half-open'
        ? 'degraded'
        : this.circuit.failures > 2
          ? 'degraded'
          : 'healthy';
    return {
      provider,
      latencyMs: 0, // Would be tracked from reportProviderResult
      errorRate: this.circuit.failures / Math.max(1, CIRCUIT_FAILURE_THRESHOLD),
      circuitState: this.circuit.state,
      grade,
    };
  }

  private assessContextHealth(now: number): ContextHealth {
    const ratio = this.callbacks.getContextUsageRatio();

    // Compute trajectory from history
    let trajectory: 'stable' | 'rising' | 'critical' = 'stable';
    if (this.contextHistory.length >= 3) {
      const recent = this.contextHistory.slice(-3);
      const slope = (recent[2]!.ratio - recent[0]!.ratio) / 2;
      if (ratio > this.options.contextCriticalRatio) {
        trajectory = 'critical';
      } else if (slope > 0.02) {
        trajectory = 'rising';
      }
    }

    const grade = ratio > this.options.contextCriticalRatio
      ? 'critical'
      : ratio > this.options.contextWarningRatio
        ? 'degraded'
        : 'healthy';
    return {
      tokenUsageRatio: ratio,
      compactionCount: this.compactionCount,
      lastCompactionMs: this.lastCompactionMs > 0 ? now - this.lastCompactionMs : -1,
      trajectory,
      grade,
    };
  }

  private assessEventLoopHealth(): EventLoopHealth {
    const samples = this.lagSamples;
    const current = samples.length > 0 ? samples[samples.length - 1]! : 0;
    const avg = samples.length > 0
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : 0;
    const max = samples.length > 0 ? Math.max(...samples) : 0;

    const grade = current > this.options.lagCriticalMs
      ? 'critical'
      : current > this.options.lagWarningMs
        ? 'degraded'
        : 'healthy';
    return { lagMs: current, avgLagMs: avg, maxLagMs: max, grade };
  }

  // ─── Event Emission ─────────────────────────────────────────────────

  private emit(
    severity: DiagnosticSeverity,
    category: DiagnosticCategory,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const event: DiagnosticEvent = {
      id: `diag-${String(++this.eventCounter)}`,
      timestamp: Date.now(),
      severity,
      category,
      code,
      message,
      details,
      recovered: category === 'recovery',
    };
    this.events.push(event);
    if (this.events.length > this.options.maxEvents) {
      this.events.shift();
    }
    this.callbacks.emitEvent(event);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(seconds % 60)}s`;
}
