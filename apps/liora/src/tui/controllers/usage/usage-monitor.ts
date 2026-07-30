/**
 * UsageMonitorController — background poller for provider quota / usage.
 *
 * Periodically fetches usage for all configured OAuth providers via the
 * SDK auth facade and pushes the aggregate snapshot into `AppState.providerQuota`.
 * The footer reads `providerQuota.worstRatio` for a live quota badge, and the
 * `/usage` panel reads the full snapshot for the multi-provider quota section.
 *
 * Polling cadence:
 *   - First fetch: 3 s after start (let the session settle).
 *   - Subsequent: every 90 s (aligns with typical rate-limit windows).
 *   - Skipped while the TUI is idle with no providers configured.
 */

import type { AllProvidersUsageSnapshot, LioraHarness } from '@superliora/sdk';

export interface UsageMonitorOptions {
  readonly harness: LioraHarness;
  readonly setAppState: (patch: { providerQuota: AllProvidersUsageSnapshot | null }) => void;
  readonly requestRender: () => void;
  /** Override the poll interval (ms). Defaults to 90 000. */
  readonly pollIntervalMs?: number;
  /** Override the initial delay (ms). Defaults to 3 000. */
  readonly initialDelayMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 90_000;
const DEFAULT_INITIAL_DELAY_MS = 3_000;

export class UsageMonitorController {
  private readonly harness: LioraHarness;
  private readonly setAppState: UsageMonitorOptions['setAppState'];
  private readonly requestRender: () => void;
  private readonly pollIntervalMs: number;
  private readonly initialDelayMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private fetching = false;
  /** Last snapshot for synchronous reads (footer badge between polls). */
  private lastSnapshot: AllProvidersUsageSnapshot | null = null;

  constructor(options: UsageMonitorOptions) {
    this.harness = options.harness;
    this.setAppState = options.setAppState;
    this.requestRender = options.requestRender;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  }

  /** Start the background poller. Idempotent. */
  start(): void {
    if (this.disposed || this.pollTimer !== null || this.initialTimer !== null) return;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.poll();
      this.pollTimer = setInterval(() => {
        void this.poll();
      }, this.pollIntervalMs);
      this.pollTimer.unref?.();
    }, this.initialDelayMs);
    this.initialTimer.unref?.();
  }

  /** Force an immediate refresh (e.g. after /login or /usage). */
  async refresh(): Promise<void> {
    await this.poll();
  }

  /** The most recent snapshot (may be null before the first poll completes). */
  get snapshot(): AllProvidersUsageSnapshot | null {
    return this.lastSnapshot;
  }

  dispose(): void {
    this.disposed = true;
    if (this.initialTimer !== null) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.fetching) return;
    this.fetching = true;
    try {
      const snapshot = await this.harness.auth.getAllProvidersUsage();
      if (this.disposed) return;
      this.lastSnapshot = snapshot;
      this.setAppState({ providerQuota: snapshot });
      this.requestRender();
    } catch {
      // Best-effort: keep the last snapshot on transient failures.
    } finally {
      this.fetching = false;
    }
  }
}
