/**
 * NotificationCenter — grouped notifications with history and actions.
 *
 * Provides a notification center UI:
 * - Notification grouping by source/app
 * - Priority levels (low/normal/high/urgent)
 * - Action buttons per notification
 * - Read/unread tracking
 * - Dismiss individual or all
 * - Snooze notifications
 * - Notification history with timestamps
 * - Badge counts per group
 * - Filter by priority/read status
 * - Auto-collapse old notifications
 * - Sound/vibration hints (visual indicators)
 *
 * Visual style:
 * ┌─ Notifications ──────────────────────── [3 unread] ┐
 * │                                                   │
 * │ ▾ System (2)                                      │
 * │   ● Update available         v2.1.0    [Install]  │
 * │     5 min ago                                     │
 * │   ○ Disk space low           85% used  [Clean]    │
 * │     1 hour ago                                    │
 * │                                                   │
 * │ ▾ Messages (1)                                    │
 * │   ● New message from Alice   "Hey..."  [Reply]    │
 * │     2 min ago                                     │
 * │                                                   │
 * │ [Mark all read] [Clear]              3 unread     │
 * └───────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface NotificationAction {
  readonly id: string;
  readonly label: string;
  readonly style?: 'primary' | 'danger' | 'default';
}

export interface Notification {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly source: string;
  readonly priority: NotificationPriority;
  readonly timestamp: number;
  readonly read: boolean;
  readonly dismissed: boolean;
  readonly snoozedUntil?: number;
  readonly actions?: NotificationAction[];
  readonly icon?: string;
  readonly metadata?: Record<string, string>;
}

export interface NotificationGroup {
  readonly source: string;
  readonly notifications: Notification[];
  readonly unreadCount: number;
  readonly collapsed: boolean;
}

export interface NotificationRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly showTimestamps?: boolean;
  readonly showActions?: boolean;
  readonly groupBySource?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// NotificationCenter
// ---------------------------------------------------------------------------

const PRIORITY_ICONS: Record<NotificationPriority, string> = {
  low: '○', normal: '●', high: '◆', urgent: '⚠',
};

const PRIORITY_TOKENS: Record<NotificationPriority, string> = {
  low: 'textMuted', normal: 'primary', high: 'warning', urgent: 'error',
};

export class NotificationHub {
  private notifications: Map<string, Notification> = new Map();
  private collapsedSources: Set<string> = new Set();
  private counter = 0;
  private filterPriority: NotificationPriority | null = null;
  private showUnreadOnly = false;

  // ─── Notification Management ─────────────────────────────────────

  /** Push a new notification. */
  push(options: {
    title: string;
    body?: string;
    source: string;
    priority?: NotificationPriority;
    actions?: NotificationAction[];
    icon?: string;
    metadata?: Record<string, string>;
  }): string {
    const id = `notif-${String(++this.counter)}`;
    const notification: Notification = {
      id,
      title: options.title,
      body: options.body,
      source: options.source,
      priority: options.priority ?? 'normal',
      timestamp: Date.now(),
      read: false,
      dismissed: false,
      actions: options.actions,
      icon: options.icon,
      metadata: options.metadata,
    };
    this.notifications.set(id, notification);
    return id;
  }

  /** Push with explicit timestamp (for demo/testing). */
  pushAt(timestamp: number, options: {
    title: string;
    body?: string;
    source: string;
    priority?: NotificationPriority;
    actions?: NotificationAction[];
  }): string {
    const id = `notif-${String(++this.counter)}`;
    const notification: Notification = {
      id,
      title: options.title,
      body: options.body,
      source: options.source,
      priority: options.priority ?? 'normal',
      timestamp,
      read: false,
      dismissed: false,
      actions: options.actions,
    };
    this.notifications.set(id, notification);
    return id;
  }

  /** Mark as read. */
  markRead(id: string): void {
    const notif = this.notifications.get(id);
    if (notif) {
      this.notifications.set(id, { ...notif, read: true });
    }
  }

  /** Mark all as read. */
  markAllRead(): void {
    for (const [id, notif] of this.notifications) {
      this.notifications.set(id, { ...notif, read: true });
    }
  }

  /** Dismiss a notification. */
  dismiss(id: string): void {
    const notif = this.notifications.get(id);
    if (notif) {
      this.notifications.set(id, { ...notif, dismissed: true });
    }
  }

  /** Dismiss all notifications. */
  dismissAll(): void {
    for (const [id, notif] of this.notifications) {
      this.notifications.set(id, { ...notif, dismissed: true });
    }
  }

  /** Snooze a notification. */
  snooze(id: string, durationMs: number): void {
    const notif = this.notifications.get(id);
    if (notif) {
      this.notifications.set(id, { ...notif, snoozedUntil: Date.now() + durationMs });
    }
  }

  /** Remove dismissed notifications. */
  clearDismissed(): void {
    for (const [id, notif] of this.notifications) {
      if (notif.dismissed) {
        this.notifications.delete(id);
      }
    }
  }

  // ─── Querying ────────────────────────────────────────────────────

  /** Get active (non-dismissed, non-snoozed) notifications. */
  getActive(): Notification[] {
    const now = Date.now();
    return [...this.notifications.values()].filter((n) =>
      !n.dismissed && (!n.snoozedUntil || n.snoozedUntil <= now)
    );
  }

  /** Get unread count. */
  get unreadCount(): number {
    return this.getActive().filter((n) => !n.read).length;
  }

  /** Get notifications by source. */
  getBySource(source: string): Notification[] {
    return this.getActive().filter((n) => n.source === source);
  }

  /** Get grouped notifications. */
  getGroups(): NotificationGroup[] {
    const active = this.getActive();
    const sourceMap = new Map<string, Notification[]>();

    for (const notif of active) {
      const list = sourceMap.get(notif.source) ?? [];
      list.push(notif);
      sourceMap.set(notif.source, list);
    }

    const groups: NotificationGroup[] = [];
    for (const [source, notifications] of sourceMap) {
      // Sort by timestamp desc
      notifications.sort((a, b) => b.timestamp - a.timestamp);
      groups.push({
        source,
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
        collapsed: this.collapsedSources.has(source),
      });
    }

    // Sort groups by most recent notification
    groups.sort((a, b) => (b.notifications[0]?.timestamp ?? 0) - (a.notifications[0]?.timestamp ?? 0));

    return groups;
  }

  // ─── Filtering ───────────────────────────────────────────────────

  /** Set priority filter. */
  setPriorityFilter(priority: NotificationPriority | null): void {
    this.filterPriority = priority;
  }

  /** Toggle unread-only filter. */
  setShowUnreadOnly(show: boolean): void {
    this.showUnreadOnly = show;
  }

  // ─── Group Collapse ──────────────────────────────────────────────

  /** Toggle group collapse. */
  toggleGroup(source: string): void {
    if (this.collapsedSources.has(source)) {
      this.collapsedSources.delete(source);
    } else {
      this.collapsedSources.add(source);
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the notification center. */
  render(options: NotificationRenderOptions): string[] {
    const { width, height, showTimestamps = true, showActions = true, groupBySource = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header
    const unread = this.unreadCount;
    const unreadBadge = unread > 0 ? ` [${boldFg('warning', `${String(unread)} unread`)}]` : '';
    const title = ` Notifications`;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)}${'─'.repeat(Math.max(0, innerWidth - title.length - 14))}${unreadBadge} ┐`));

    // Get notifications (filtered)
    let groups = this.getGroups();

    if (this.filterPriority) {
      groups = groups.map((g) => ({
        ...g,
        notifications: g.notifications.filter((n) => n.priority === this.filterPriority),
        unreadCount: g.notifications.filter((n) => n.priority === this.filterPriority && !n.read).length,
      })).filter((g) => g.notifications.length > 0);
    }

    if (this.showUnreadOnly) {
      groups = groups.map((g) => ({
        ...g,
        notifications: g.notifications.filter((n) => !n.read),
        unreadCount: g.notifications.filter((n) => !n.read).length,
      })).filter((g) => g.notifications.length > 0);
    }

    const contentHeight = height - 4;
    let lineCount = 0;

    if (groupBySource) {
      for (const group of groups) {
        if (lineCount >= contentHeight) break;

        // Group header
        const collapseIcon = group.collapsed ? '▸' : '▾';
        const unreadMark = group.unreadCount > 0 ? fg('warning', ` (${String(group.unreadCount)})`) : '';
        const groupLine = ` ${boldFg('accent', `${collapseIcon} ${group.source}`)}${unreadMark}`;
        lines.push(fg('textMuted', '│') + padRight(groupLine, innerWidth) + fg('textMuted', '│'));
        lineCount++;

        if (group.collapsed) continue;

        // Notifications in group
        for (const notif of group.notifications.slice(0, 4)) {
          if (lineCount >= contentHeight) break;

          const notifLine = this.renderNotification(notif, innerWidth, showTimestamps, showActions, options);
          lines.push(fg('textMuted', '│') + notifLine + fg('textMuted', '│'));
          lineCount++;

          // Body preview
          if (notif.body && !group.collapsed) {
            const bodyLine = dimFg('textMuted', `     "${notif.body.slice(0, innerWidth - 10)}"`);
            lines.push(fg('textMuted', '│') + padRight(bodyLine, innerWidth) + fg('textMuted', '│'));
            lineCount++;
          }

          // Timestamp
          if (showTimestamps) {
            const timeLine = dimFg('textMuted', `     ${formatRelativeTime(notif.timestamp)}`);
            lines.push(fg('textMuted', '│') + padRight(timeLine, innerWidth) + fg('textMuted', '│'));
            lineCount++;
          }
        }

        // Blank line between groups
        if (lineCount < contentHeight) {
          lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
          lineCount++;
        }
      }
    } else {
      // Flat list
      const allNotifs = groups.flatMap((g) => g.notifications).sort((a, b) => b.timestamp - a.timestamp);
      for (const notif of allNotifs.slice(0, contentHeight)) {
        const notifLine = this.renderNotification(notif, innerWidth, showTimestamps, showActions, options);
        lines.push(fg('textMuted', '│') + notifLine + fg('textMuted', '│'));
      }
    }

    // Pad
    while (lines.length < height - 1) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Footer
    const actions = `${fg('success', '[Mark all read]')} ${fg('error', '[Clear]')}`;
    const footer = ` ${actions}              ${unread > 0 ? fg('warning', `${String(unread)} unread`) : dimFg('textMuted', 'all read')}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderNotification(notif: Notification, width: number, showTimestamps: boolean, showActions: boolean, options: NotificationRenderOptions): string {
    const { fg, boldFg, dimFg } = options;

    const readIcon = notif.read ? dimFg('textMuted', '○') : fg(PRIORITY_TOKENS[notif.priority], PRIORITY_ICONS[notif.priority]);
    const titleStr = notif.read ? dimFg('textMuted', notif.title) : boldFg('text', notif.title);
    const priorityHint = notif.priority === 'urgent' ? fg('error', ' !') : notif.priority === 'high' ? fg('warning', ' *') : '';

    // Action button
    let actionStr = '';
    if (showActions && notif.actions && notif.actions.length > 0) {
      const action = notif.actions[0]!;
      const actionToken = action.style === 'primary' ? 'primary' : action.style === 'danger' ? 'error' : 'textMuted';
      actionStr = ` ${fg(actionToken, `[${action.label}]`)}`;
    }

    // Metadata hint
    const metaHint = notif.metadata?.['hint'] ? dimFg('textMuted', ` ${notif.metadata['hint']}`) : '';

    const line = `   ${readIcon} ${titleStr}${priorityHint}${metaHint}${actionStr}`;
    return padRight(line, width);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hour${Math.floor(diff / 3600000) > 1 ? 's' : ''} ago`;
  return `${Math.floor(diff / 86400000)} day${Math.floor(diff / 86400000) > 1 ? 's' : ''} ago`;
}

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo notification hub with sample data. */
export function createDemoNotificationHub(): NotificationHub {
  const center = new NotificationHub();
  const now = Date.now();

  center.pushAt(now - 5 * 60000, {
    title: 'Update available',
    body: 'Version 2.1.0 is ready to install',
    source: 'System',
    priority: 'normal',
    actions: [{ id: 'install', label: 'Install', style: 'primary' }],
  });

  center.pushAt(now - 60 * 60000, {
    title: 'Disk space low',
    body: '85% of storage used',
    source: 'System',
    priority: 'high',
    actions: [{ id: 'clean', label: 'Clean', style: 'danger' }],
  });

  center.pushAt(now - 2 * 60000, {
    title: 'New message from Alice',
    body: 'Hey, can you review my PR?',
    source: 'Messages',
    priority: 'normal',
    actions: [{ id: 'reply', label: 'Reply', style: 'primary' }],
  });

  center.pushAt(now - 30 * 60000, {
    title: 'Build failed',
    body: 'Pipeline #1234 failed at test stage',
    source: 'CI/CD',
    priority: 'urgent',
    actions: [{ id: 'view', label: 'View Logs' }],
  });

  center.pushAt(now - 10 * 60000, {
    title: 'Deployment complete',
    body: 'v2.0.9 deployed to production',
    source: 'CI/CD',
    priority: 'low',
  });

  // Mark one as read
  center.markRead('notif-5');

  return center;
}
