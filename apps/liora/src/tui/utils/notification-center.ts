/**
 * NotificationCenter — aggregated notification system with priority levels.
 *
 * Provides a unified notification hub for the TUI:
 * - Priority levels (critical, warning, info, success, debug)
 * - Auto-dismiss with configurable TTL per priority
 * - Action buttons (approve, retry, dismiss, navigate)
 * - Toast-style transient display + persistent list
 * - Grouping by source (agent, system, git, user)
 * - Unread badge count for status bar
 * - Sound trigger integration (maps to SoundController events)
 * - Keyboard navigation in notification list view
 *
 * Display modes:
 * - Toast: Bottom-right overlay, auto-dismiss (3-8s based on priority)
 * - List: Full panel with scrollable history
 * - Badge: Compact count indicator for status bar
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationPriority = 'critical' | 'warning' | 'info' | 'success' | 'debug';

export type NotificationSource = 'agent' | 'system' | 'git' | 'user' | 'network' | 'security';

export interface NotificationAction {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  /** Whether this action dismisses the notification. */
  readonly dismisses: boolean;
}

export interface Notification {
  readonly id: string;
  readonly priority: NotificationPriority;
  readonly source: NotificationSource;
  readonly title: string;
  readonly body?: string;
  readonly timestamp: number;
  readonly read: boolean;
  readonly dismissed: boolean;
  /** Auto-dismiss timestamp (null = persistent). */
  readonly expiresAt: number | null;
  readonly actions: readonly NotificationAction[];
  /** Optional metadata for navigation (e.g. agent ID, file path). */
  readonly metadata?: Record<string, string>;
}

export interface ToastState {
  readonly notification: Notification;
  readonly visibleSince: number;
  readonly progress: number; // 0-1 (1 = about to dismiss)
}

export interface NotificationRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
  readonly now?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_GLYPH: Record<NotificationPriority, string> = {
  critical: '🔴',
  warning: '🟡',
  info: '🔵',
  success: '🟢',
  debug: '⚪',
};

const PRIORITY_COLOR: Record<NotificationPriority, string> = {
  critical: 'error',
  warning: 'warning',
  info: 'primary',
  success: 'success',
  debug: 'textMuted',
};

const PRIORITY_LABEL: Record<NotificationPriority, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  info: 'INFO',
  success: 'SUCCESS',
  debug: 'DEBUG',
};

const SOURCE_GLYPH: Record<NotificationSource, string> = {
  agent: '🤖',
  system: '⚙',
  git: '🌿',
  user: '👤',
  network: '🌐',
  security: '🔒',
};

/** Auto-dismiss TTL by priority (ms). Null = persistent. */
const PRIORITY_TTL: Record<NotificationPriority, number | null> = {
  critical: null, // Never auto-dismiss
  warning: 8000,
  info: 5000,
  success: 3000,
  debug: 2000,
};

/** Maximum toast stack size. */
const MAX_VISIBLE_TOASTS = 3;

/** Maximum notification history. */
const MAX_HISTORY = 100;

// ---------------------------------------------------------------------------
// NotificationCenter
// ---------------------------------------------------------------------------

export class NotificationCenter {
  private notifications: Notification[] = [];
  private counter = 0;
  private toastQueue: ToastState[] = [];
  private onAction: ((notificationId: string, actionId: string) => void) | null = null;
  private onNewNotification: ((n: Notification) => void) | null = null;

  // ─── Event Handlers ───────────────────────────────────────────────

  setActionHandler(handler: (notificationId: string, actionId: string) => void): void {
    this.onAction = handler;
  }

  setNewNotificationHandler(handler: (n: Notification) => void): void {
    this.onNewNotification = handler;
  }

  // ─── Notification Creation ────────────────────────────────────────

  /** Push a new notification. Returns the notification ID. */
  push(
    priority: NotificationPriority,
    source: NotificationSource,
    title: string,
    options?: {
      body?: string;
      actions?: NotificationAction[];
      metadata?: Record<string, string>;
      ttl?: number | null;
    },
  ): string {
    const id = `notif-${String(++this.counter)}`;
    const now = Date.now();
    const ttl = options?.ttl !== undefined ? options.ttl : PRIORITY_TTL[priority];

    const notification: Notification = {
      id,
      priority,
      source,
      title,
      body: options?.body,
      timestamp: now,
      read: false,
      dismissed: false,
      expiresAt: ttl !== null ? now + ttl : null,
      actions: options?.actions ?? [],
      metadata: options?.metadata,
    };

    this.notifications.unshift(notification);

    // Trim history
    if (this.notifications.length > MAX_HISTORY) {
      this.notifications = this.notifications.slice(0, MAX_HISTORY);
    }

    // Add to toast queue
    this.toastQueue.push({ notification, visibleSince: now, progress: 0 });
    if (this.toastQueue.length > MAX_VISIBLE_TOASTS) {
      this.toastQueue.shift();
    }

    // Fire handler
    if (this.onNewNotification) {
      this.onNewNotification(notification);
    }

    return id;
  }

  /** Convenience: push a critical notification. */
  critical(source: NotificationSource, title: string, body?: string): string {
    return this.push('critical', source, title, { body });
  }

  /** Convenience: push a warning notification. */
  warn(source: NotificationSource, title: string, body?: string): string {
    return this.push('warning', source, title, { body });
  }

  /** Convenience: push an info notification. */
  info(source: NotificationSource, title: string, body?: string): string {
    return this.push('info', source, title, { body });
  }

  /** Convenience: push a success notification. */
  success(source: NotificationSource, title: string, body?: string): string {
    return this.push('success', source, title, { body });
  }

  // ─── Notification Management ──────────────────────────────────────

  /** Mark a notification as read. */
  markRead(id: string): void {
    const n = this.notifications.find((n) => n.id === id);
    if (n) (n as { read: boolean }).read = true;
  }

  /** Mark all as read. */
  markAllRead(): void {
    for (const n of this.notifications) {
      (n as { read: boolean }).read = true;
    }
  }

  /** Dismiss a notification (removes from toast, keeps in history). */
  dismiss(id: string): void {
    const n = this.notifications.find((n) => n.id === id);
    if (n) (n as { dismissed: boolean }).dismissed = true;
    this.toastQueue = this.toastQueue.filter((t) => t.notification.id !== id);
  }

  /** Dismiss all toasts. */
  dismissAllToasts(): void {
    this.toastQueue = [];
  }

  /** Clear all history. */
  clearAll(): void {
    this.notifications = [];
    this.toastQueue = [];
  }

  /** Execute an action on a notification. */
  executeAction(notificationId: string, actionId: string): void {
    const n = this.notifications.find((n) => n.id === notificationId);
    if (!n) return;

    const action = n.actions.find((a) => a.id === actionId);
    if (action?.dismisses) {
      this.dismiss(notificationId);
    }

    if (this.onAction) {
      this.onAction(notificationId, actionId);
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /** Get unread count. */
  getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read && !n.dismissed).length;
  }

  /** Get critical unread count. */
  getCriticalCount(): number {
    return this.notifications.filter((n) => !n.read && !n.dismissed && n.priority === 'critical').length;
  }

  /** Get all notifications (newest first). */
  getAll(): readonly Notification[] {
    return this.notifications;
  }

  /** Get active (non-dismissed) notifications. */
  getActive(): Notification[] {
    return this.notifications.filter((n) => !n.dismissed);
  }

  /** Get visible toasts (updates progress, removes expired). */
  getToasts(now: number = Date.now()): ToastState[] {
    // Remove expired toasts
    this.toastQueue = this.toastQueue.filter((t) => {
      if (t.notification.expiresAt === null) return true;
      return now < t.notification.expiresAt;
    });

    // Update progress
    return this.toastQueue.map((t) => {
      if (t.notification.expiresAt === null) {
        return { ...t, progress: 0 };
      }
      const totalTtl = t.notification.expiresAt - t.visibleSince;
      const elapsed = now - t.visibleSince;
      return { ...t, progress: Math.min(1, elapsed / totalTtl) };
    });
  }

  // ─── Rendering ────────────────────────────────────────────────────

  /** Render toast notifications (bottom-right overlay). */
  renderToasts(options: NotificationRenderOptions): string[] {
    const { width, fg, boldFg, dimFg, bg, now = Date.now() } = options;
    const toasts = this.getToasts(now);
    const lines: string[] = [];
    const toastWidth = Math.min(width - 4, 45);

    for (const toast of toasts) {
      const n = toast.notification;
      const color = PRIORITY_COLOR[n.priority];
      const glyph = PRIORITY_GLYPH[n.priority];
      const sourceGlyph = SOURCE_GLYPH[n.source];

      // Top border with priority color
      lines.push(fg(color, `┌${'─'.repeat(toastWidth - 2)}┐`));

      // Title line
      const title = truncateStr(n.title, toastWidth - 8);
      const titleContent = ` ${glyph} ${boldFg('text', title)}`;
      lines.push(fg(color, '│') + ansiPadEnd(titleContent, toastWidth - 2) + fg(color, '│'));

      // Body (if present)
      if (n.body) {
        const body = truncateStr(n.body, toastWidth - 6);
        lines.push(fg(color, '│') + ansiPadEnd(dimFg('textMuted', `   ${body}`), toastWidth - 2) + fg(color, '│'));
      }

      // Actions (if any)
      if (n.actions.length > 0) {
        const actionStr = n.actions.map((a) => fg('accent', `[${a.label}]`)).join(' ');
        lines.push(fg(color, '│') + ansiPadEnd(` ${actionStr}`, toastWidth - 2) + fg(color, '│'));
      }

      // Progress bar (time to dismiss)
      if (toast.progress > 0) {
        const barW = toastWidth - 4;
        const remaining = Math.round((1 - toast.progress) * barW);
        lines.push(fg(color, '│') + ' ' + dimFg('textMuted', '░'.repeat(barW - remaining)) + fg(color, '█'.repeat(remaining)) + ' ' + fg(color, '│'));
      }

      // Bottom border
      lines.push(fg(color, `└${'─'.repeat(toastWidth - 2)}┘`));
      lines.push(''); // Gap between toasts
    }

    return lines;
  }

  /** Render the full notification list panel. */
  renderList(options: NotificationRenderOptions): string[] {
    const { width, height, fg, boldFg, dimFg, now = Date.now() } = options;
    const lines: string[] = [];
    const active = this.getActive();

    // Header
    const unread = this.getUnreadCount();
    const badge = unread > 0 ? fg('error', ` (${String(unread)} unread)`) : '';
    lines.push(boldFg('text', ` Notifications${badge}`));
    lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, 40))));

    if (active.length === 0) {
      lines.push(dimFg('textMuted', '  No notifications'));
      return lines;
    }

    for (const n of active.slice(0, height - 3)) {
      const color = PRIORITY_COLOR[n.priority];
      const glyph = PRIORITY_GLYPH[n.priority];
      const sourceGlyph = SOURCE_GLYPH[n.source];
      const readMark = n.read ? dimFg('textMuted', '○') : fg('accent', '●');
      const timeAgo = formatTimeAgo(n.timestamp, now);

      // Title line
      const title = truncateStr(n.title, width - 14);
      const titleText = n.read ? fg('text', title) : boldFg('text', title);
      lines.push(` ${readMark} ${glyph} ${titleText} ${dimFg('textMuted', timeAgo)}`);

      // Body (if present and not read)
      if (n.body && !n.read) {
        const body = truncateStr(n.body, width - 10);
        lines.push(dimFg('textMuted', `     ${body}`));
      }

      // Actions
      if (n.actions.length > 0 && !n.read) {
        const actionStr = n.actions.map((a) => {
          const shortcut = a.shortcut ? dimFg('textMuted', ` (${a.shortcut})`) : '';
          return fg('accent', `[${a.label}]`) + shortcut;
        }).join(' ');
        lines.push(`     ${actionStr}`);
      }
    }

    return lines;
  }

  /** Render a compact badge for the status bar. */
  renderBadge(fg: (t: string, s: string) => string): string {
    const unread = this.getUnreadCount();
    const critical = this.getCriticalCount();

    if (unread === 0) return '';
    if (critical > 0) {
      return fg('error', `🔔${String(unread)}`);
    }
    return fg('warning', `🔔${String(unread)}`);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function truncateStr(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

/** Strip ANSI escape sequences for width calculation. */
function stripAnsi(s: string): string {
  return s.replace(/\u001B\[[0-9;]*m/g, '');
}

/** Pad a string to a target width, accounting for ANSI escape sequences. */
function ansiPadEnd(s: string, targetWidth: number): string {
  const visibleLen = stripAnsi(s).length;
  const padding = Math.max(0, targetWidth - visibleLen);
  return s + ' '.repeat(padding);
}

function formatTimeAgo(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return 'now';
  if (sec < 60) return `${String(sec)}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m`;
  const hour = Math.floor(min / 60);
  return `${String(hour)}h`;
}
