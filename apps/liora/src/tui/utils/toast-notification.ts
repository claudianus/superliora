/**
 * ToastNotification — non-blocking toast/notification system.
 *
 * Provides GUI-quality notification toasts:
 * - Severity levels: info, success, warning, error
 * - Auto-dismiss with configurable duration
 * - Manual dismiss (click/keypress)
 * - Stacking (multiple toasts visible simultaneously)
 * - Slide-in/fade-out animation support
 * - Action buttons (e.g., "Undo", "Retry")
 * - Progress toasts (indeterminate/determinate)
 * - Icon per severity
 * - Title + message body
 * - Position: top-right, top-center, bottom-right, bottom-center
 * - Pause auto-dismiss on hover
 * - Deduplication (same message within cooldown)
 * - Max visible limit with overflow queue
 *
 * Visual style:
 * ┌─ ✓ Success ─────────────────────┐
 * │ File saved successfully          │
 * │                    [Undo] [×]    │
 * └──────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export type ToastPosition = 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center';

export interface ToastAction {
  readonly label: string;
  readonly action: () => void;
  readonly dismissOnClick?: boolean;
}

export interface ToastOptions {
  readonly severity: ToastSeverity;
  readonly title: string;
  readonly message?: string;
  readonly duration?: number; // ms, 0 = persistent
  readonly actions?: ToastAction[];
  readonly icon?: string;
  readonly progress?: number; // 0-1 for determinate, -1 for indeterminate
  readonly group?: string; // For deduplication
  readonly id?: string;
}

export interface Toast {
  readonly id: string;
  readonly severity: ToastSeverity;
  readonly title: string;
  readonly message?: string;
  readonly createdAt: number;
  readonly duration: number;
  readonly actions: readonly ToastAction[];
  readonly icon: string;
  readonly progress?: number;
  readonly group?: string;
  readonly paused: boolean;
  readonly dismissAt: number; // timestamp when auto-dismiss triggers
}

export interface ToastRenderOptions {
  readonly width: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 5;
const DEDUP_COOLDOWN = 2000; // ms

const SEVERITY_ICONS: Record<ToastSeverity, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✗',
};

const SEVERITY_COLORS: Record<ToastSeverity, string> = {
  info: 'primary',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

const SEVERITY_LABELS: Record<ToastSeverity, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
};

// ---------------------------------------------------------------------------
// ToastManager
// ---------------------------------------------------------------------------

export class ToastManager {
  private toasts: Toast[] = [];
  private queue: ToastOptions[] = [];
  private counter = 0;
  private position: ToastPosition = 'top-right';
  private lastGroupTime: Map<string, number> = new Map();

  constructor(options?: { position?: ToastPosition }) {
    this.position = options?.position ?? 'top-right';
  }

  // ─── Toast Lifecycle ─────────────────────────────────────────────

  /** Show a new toast notification. Returns the toast ID. */
  show(options: ToastOptions): string {
    // Deduplication check
    if (options.group) {
      const lastTime = this.lastGroupTime.get(options.group);
      if (lastTime && Date.now() - lastTime < DEDUP_COOLDOWN) {
        // Update existing toast in same group
        const existing = this.toasts.find((t) => t.group === options.group);
        if (existing) {
          this.update(existing.id, { title: options.title, message: options.message });
          return existing.id;
        }
      }
      this.lastGroupTime.set(options.group, Date.now());
    }

    const id = options.id ?? `toast-${String(++this.counter)}`;
    const duration = options.duration ?? DEFAULT_DURATION;
    const now = Date.now();

    const toast: Toast = {
      id,
      severity: options.severity,
      title: options.title,
      message: options.message,
      createdAt: now,
      duration,
      actions: options.actions ?? [],
      icon: options.icon ?? SEVERITY_ICONS[options.severity],
      progress: options.progress,
      group: options.group,
      paused: false,
      dismissAt: duration > 0 ? now + duration : Infinity,
    };

    if (this.toasts.length >= MAX_VISIBLE) {
      this.queue.push(options);
    } else {
      this.toasts.push(toast);
    }

    return id;
  }

  /** Convenience: show info toast. */
  info(title: string, message?: string, duration?: number): string {
    return this.show({ severity: 'info', title, message, duration });
  }

  /** Convenience: show success toast. */
  success(title: string, message?: string, duration?: number): string {
    return this.show({ severity: 'success', title, message, duration });
  }

  /** Convenience: show warning toast. */
  warning(title: string, message?: string, duration?: number): string {
    return this.show({ severity: 'warning', title, message, duration });
  }

  /** Convenience: show error toast. */
  error(title: string, message?: string, duration?: number): string {
    return this.show({ severity: 'error', title, message, duration });
  }

  /** Dismiss a specific toast. */
  dismiss(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.promoteFromQueue();
  }

  /** Dismiss all toasts. */
  dismissAll(): void {
    this.toasts = [];
    this.queue = [];
  }

  /** Pause auto-dismiss for a toast (hover). */
  pause(id: string): void {
    const toast = this.toasts.find((t) => t.id === id);
    if (toast) {
      this.toasts = this.toasts.map((t) =>
        t.id === id ? { ...t, paused: true, dismissAt: Infinity } : t,
      );
    }
  }

  /** Resume auto-dismiss for a toast. */
  resume(id: string): void {
    const toast = this.toasts.find((t) => t.id === id);
    if (toast && toast.duration > 0) {
      const remaining = toast.duration - (Date.now() - toast.createdAt);
      this.toasts = this.toasts.map((t) =>
        t.id === id ? { ...t, paused: false, dismissAt: Date.now() + Math.max(remaining, 1000) } : t,
      );
    }
  }

  /** Update a toast's content. */
  update(id: string, updates: { title?: string; message?: string; progress?: number }): void {
    this.toasts = this.toasts.map((t) =>
      t.id === id
        ? { ...t, title: updates.title ?? t.title, message: updates.message ?? t.message, progress: updates.progress ?? t.progress }
        : t,
    );
  }

  /** Tick: remove expired toasts and promote from queue. */
  tick(): void {
    const now = Date.now();
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.dismissAt > now);
    if (this.toasts.length < before) {
      this.promoteFromQueue();
    }
  }

  private promoteFromQueue(): void {
    while (this.toasts.length < MAX_VISIBLE && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.show(next);
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get all visible toasts. */
  getToasts(): readonly Toast[] {
    return this.toasts;
  }

  /** Get toast count. */
  get count(): number {
    return this.toasts.length;
  }

  /** Get queued count. */
  get queuedCount(): number {
    return this.queue.length;
  }

  /** Get position. */
  getPosition(): ToastPosition {
    return this.position;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render all visible toasts. */
  render(options: ToastRenderOptions): string[] {
    const lines: string[] = [];

    for (const toast of this.toasts) {
      lines.push(...this.renderToast(toast, options));
      lines.push(''); // Gap between toasts
    }

    if (this.queue.length > 0) {
      lines.push(options.dimFg('textMuted', `  +${String(this.queue.length)} more...`));
    }

    return lines;
  }

  private renderToast(toast: Toast, options: ToastRenderOptions): string[] {
    const { width, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 4; // borders + padding
    const color = SEVERITY_COLORS[toast.severity];

    // Top border with severity label
    const label = ` ${toast.icon} ${SEVERITY_LABELS[toast.severity]} `;
    const topBorder = `┌─${fg(color, label)}${'─'.repeat(Math.max(0, innerWidth - label.length - 1))}┐`;
    lines.push(topBorder);

    // Title
    const title = truncate(toast.title, innerWidth);
    lines.push(`│ ${boldFg('text', padRight(title, innerWidth))} │`);

    // Message (optional)
    if (toast.message) {
      const msgLines = wrapText(toast.message, innerWidth);
      for (const msgLine of msgLines.slice(0, 2)) {
        lines.push(`│ ${dimFg('textMuted', padRight(msgLine, innerWidth))} │`);
      }
    }

    // Progress bar (if present)
    if (toast.progress !== undefined) {
      const barWidth = innerWidth - 2;
      if (toast.progress < 0) {
        // Indeterminate
        lines.push(`│ ${fg(color, '░'.repeat(barWidth))} │`);
      } else {
        const filled = Math.round(barWidth * toast.progress);
        const bar = fg(color, '█'.repeat(filled)) + dimFg('textDim', '░'.repeat(barWidth - filled));
        lines.push(`│ ${bar} │`);
      }
    }

    // Actions row
    if (toast.actions.length > 0) {
      const actionStrs = toast.actions.map((a) => fg('primary', `[${a.label}]`));
      const actionsLine = actionStrs.join(' ') + ' ' + dimFg('textMuted', '[×]');
      lines.push(`│ ${padRight(actionsLine, innerWidth)} │`);
    }

    // Bottom border
    lines.push(`└${'─'.repeat(innerWidth + 2)}┘`);

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function padRight(text: string, width: number): string {
  // Simple pad (no ANSI awareness needed for plain text here)
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - plain.length);
  return text + ' '.repeat(padding);
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
