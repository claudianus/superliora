/**
 * UsageMonitorController — background poller for provider quota / usage.
 *
 * Fetches via `getAllProvidersUsage()` and writes `AppState.providerQuota`.
 * The footer reads the cached snapshot only — never fetches during render.
 *
 * Cadence is driven by the appearance/ambient frame clock (`tick`), not a
 * raw `setInterval`. Wall-clock gap is 150s (cache TTL is ≥120s).
 */

import { applyUsageSnapshotsToCredentialHealth } from '@superliora/oauth';
import type { AllProvidersUsageSnapshot, LioraHarness } from '@superliora/sdk';

export interface UsageMonitorOptions {
  readonly harness: LioraHarness;
  readonly setAppState: (patch: { providerQuota: AllProvidersUsageSnapshot | null }) => void;
  readonly requestRender: () => void;
  /** Override the poll interval (ms). Defaults to 150 000. */
  readonly pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 150_000;

export class UsageMonitorController {
  private readonly harness: LioraHarness;
  private readonly setAppState: UsageMonitorOptions['setAppState'];
  private readonly requestRender: () => void;
  private readonly pollIntervalMs: number;
  private started = false;
  private disposed = false;
  private fetching = false;
  private lastPollAt = 0;
  private lastSnapshot: AllProvidersUsageSnapshot | null = null;

  constructor(options: UsageMonitorOptions) {
    this.harness = options.harness;
    this.setAppState = options.setAppState;
    this.requestRender = options.requestRender;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /** Start: one background fetch. Later refreshes come from `tick`. */
  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    void this.poll();
  }

  /**
   * Appearance-clock hook. Call from the native frame callback.
   * Fetches only when the wall-clock gap exceeds the poll interval.
   */
  tick(nowMs: number = Date.now()): void {
    if (this.disposed || !this.started) return;
    if (this.lastPollAt > 0 && nowMs - this.lastPollAt < this.pollIntervalMs) return;
    void this.poll();
  }

  /** Force an immediate refresh (e.g. after /login or /quota). */
  async refresh(): Promise<void> {
    await this.poll();
  }

  get snapshot(): AllProvidersUsageSnapshot | null {
    return this.lastSnapshot;
  }

  dispose(): void {
    this.disposed = true;
    this.started = false;
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.fetching) return;
    this.fetching = true;
    this.lastPollAt = Date.now();
    try {
      const snapshot = await this.harness.auth.getAllProvidersUsage();
      if (this.disposed) return;
      this.lastSnapshot = snapshot;
      try {
        applyUsageSnapshotsToCredentialHealth(snapshot);
      } catch {
        /* ignore */
      }
      this.setAppState({ providerQuota: snapshot });
      this.requestRender();
    } catch {
      // Best-effort: keep the last snapshot on transient failures.
    } finally {
      this.fetching = false;
    }
  }
}
