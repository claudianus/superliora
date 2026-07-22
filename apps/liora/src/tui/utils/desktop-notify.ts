/**
 * Desktop notification integration for long-running operations.
 *
 * Uses OSC 99 (kitty notification protocol) to alert the user when:
 * - A long-running tool/task completes (>30s)
 * - An Ultrawork run finishes
 * - An error requires attention
 * - A goal milestone is reached
 *
 * Gracefully degrades: unsupported terminals silently ignore the sequences.
 * The notification is only emitted when the terminal is unfocused (the user
 * has switched away), detected via focus events or a heuristic timer.
 */

import {
  encodeOsc99Notification,
  detectAdvancedCapabilities,
  type NotificationUrgency,
} from '@harness-kit/tui-renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationKind =
  | 'task-complete'
  | 'task-error'
  | 'ultrawork-done'
  | 'goal-milestone'
  | 'permission-needed'
  | 'session-idle';

export interface DesktopNotificationOptions {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string;
  readonly urgency?: NotificationUrgency;
  /** Duration of the operation in ms (used for the "took Xs" suffix). */
  readonly durationMs?: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let capabilitiesDetected = false;
let supportsNotifications = false;
let terminalFocused = true;
let lastFocusChange = Date.now();

/** Minimum operation duration (ms) before a completion notification fires. */
const NOTIFICATION_THRESHOLD_MS = 30_000;

/** App identifier for notification grouping. */
const APP_ID = 'superliora';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize notification capabilities from the current environment.
 * Call once at TUI startup.
 */
export function initDesktopNotifications(env: Record<string, string | undefined> = process.env): void {
  const caps = detectAdvancedCapabilities(env);
  supportsNotifications = caps.osc99Notifications;
  capabilitiesDetected = true;
}

/**
 * Track terminal focus state (called from focus event handler).
 */
export function setTerminalFocused(focused: boolean): void {
  terminalFocused = focused;
  lastFocusChange = Date.now();
}

/**
 * Whether desktop notifications are available and enabled.
 */
export function desktopNotificationsAvailable(): boolean {
  if (!capabilitiesDetected) {
    initDesktopNotifications();
  }
  return supportsNotifications;
}

/**
 * Emit a desktop notification for a completed operation.
 *
 * Only fires when:
 * 1. The terminal supports OSC 99
 * 2. The terminal is unfocused (user switched away)
 * 3. The operation exceeded the threshold duration (for task-complete)
 *
 * Returns the ANSI sequence to write to stdout, or empty string if skipped.
 */
export function notifyOperationComplete(options: DesktopNotificationOptions): string {
  if (!desktopNotificationsAvailable()) return '';

  // Only notify when the user has switched away from the terminal
  if (terminalFocused) return '';

  // For task-complete, only notify if it took long enough
  if (options.kind === 'task-complete' && options.durationMs !== undefined) {
    if (options.durationMs < NOTIFICATION_THRESHOLD_MS) return '';
  }

  const urgency = options.urgency ?? resolveDefaultUrgency(options.kind);
  const body = options.body ?? buildDefaultBody(options);

  return encodeOsc99Notification({
    title: options.title,
    body,
    urgency,
    appId: APP_ID,
    identifier: `liora-${options.kind}-${String(Date.now())}`,
    focusOnClick: true,
    silent: urgency === 'low',
  });
}

/**
 * Convenience: notify that a long-running task finished.
 */
export function notifyTaskComplete(taskLabel: string, durationMs: number): string {
  return notifyOperationComplete({
    kind: 'task-complete',
    title: `✓ ${taskLabel}`,
    durationMs,
  });
}

/**
 * Convenience: notify that an error needs attention.
 */
export function notifyError(title: string, detail?: string): string {
  // Errors always notify regardless of focus (critical urgency)
  if (!desktopNotificationsAvailable()) return '';

  return encodeOsc99Notification({
    title: `⚠ ${title}`,
    body: detail,
    urgency: 'critical',
    appId: APP_ID,
    identifier: `liora-error-${String(Date.now())}`,
    focusOnClick: true,
  });
}

/**
 * Convenience: notify Ultrawork run completion.
 */
export function notifyUltraworkDone(runLabel: string, durationMs: number): string {
  return notifyOperationComplete({
    kind: 'ultrawork-done',
    title: `⚡ Ultrawork complete`,
    body: `${runLabel} · ${formatDuration(durationMs)}`,
    durationMs: 0, // Always notify for ultrawork
  });
}

/**
 * Convenience: notify goal milestone reached.
 */
export function notifyGoalMilestone(milestone: string): string {
  return notifyOperationComplete({
    kind: 'goal-milestone',
    title: `🎯 ${milestone}`,
    urgency: 'normal',
    durationMs: 0,
  });
}

/**
 * Convenience: notify permission is needed (agent is blocked).
 */
export function notifyPermissionNeeded(action: string): string {
  // Permission needed always notifies (user must act)
  if (!desktopNotificationsAvailable()) return '';

  return encodeOsc99Notification({
    title: `🔐 Permission needed`,
    body: action,
    urgency: 'critical',
    appId: APP_ID,
    identifier: `liora-permission-${String(Date.now())}`,
    focusOnClick: true,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDefaultUrgency(kind: NotificationKind): NotificationUrgency {
  switch (kind) {
    case 'task-error':
    case 'permission-needed':
      return 'critical';
    case 'ultrawork-done':
    case 'goal-milestone':
      return 'normal';
    case 'session-idle':
      return 'low';
    default:
      return 'normal';
  }
}

function buildDefaultBody(options: DesktopNotificationOptions): string | undefined {
  if (options.durationMs !== undefined && options.durationMs > 0) {
    return `Completed in ${formatDuration(options.durationMs)}`;
  }
  return undefined;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return remainSec > 0 ? `${String(minutes)}m ${String(remainSec)}s` : `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${String(hours)}h ${String(remainMin)}m`;
}
