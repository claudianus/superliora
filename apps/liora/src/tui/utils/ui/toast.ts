/**
 * Minimal toast overlay state for transient confirmations (e.g. clipboard
 * copy). The host wires `onChanged` to request a re-render; the overlay
 * region reads `visible` and stops drawing once `expiresAtMs` has passed.
 */
export const TUI_TOAST_DURATION_MS = 1200;

export interface TUIToastSnapshot {
  readonly message: string;
  readonly expiresAtMs: number;
}

export class TUIToastState {
  /** Notified when visibility changes so the host can request a render. */
  onChanged: (() => void) | null = null;

  private current: TUIToastSnapshot | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  /** The active toast, or null when hidden. */
  get visible(): TUIToastSnapshot | null {
    return this.current;
  }

  /** Show a toast (reschedules any active one) for `durationMs`. */
  show(message: string, durationMs: number = TUI_TOAST_DURATION_MS): void {
    this.current = { message, expiresAtMs: Date.now() + durationMs };
    this.scheduleHide(durationMs);
    this.onChanged?.();
  }

  hide(): void {
    this.clearTimer();
    if (this.current === null) return;
    this.current = null;
    this.onChanged?.();
  }

  dispose(): void {
    this.clearTimer();
    this.current = null;
    this.onChanged = null;
  }

  private scheduleHide(durationMs: number): void {
    this.clearTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.hide();
    }, durationMs);
    this.hideTimer.unref?.();
  }

  private clearTimer(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
