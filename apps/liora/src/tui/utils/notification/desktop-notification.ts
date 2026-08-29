/**
 * Kitty desktop notification protocol (OSC 99).
 *
 * Sends native desktop notifications via the terminal when the agent
 * completes a task, encounters an error, or needs user attention.
 *
 * Protocol: ESC ] 99 ; i=<id> ; d=0 ; <title> ESC \
 *           ESC ] 99 ; i=<id> ; d=1 ; <body> ESC \
 *
 * Falls back silently on terminals that don't support OSC 99.
 */

import { ttui } from '#/tui/utils/tui-i18n';

let notificationCounter = 0;

export interface DesktopNotification {
  title: string;
  body?: string;
  urgency?: 'low' | 'normal' | 'critical';
}

/**
 * Send a desktop notification via Kitty OSC 99 protocol.
 */
export function sendDesktopNotification(notification: DesktopNotification): void {
  try {
    const id = `liora-${++notificationCounter}`;
    const { title, body, urgency } = notification;

    // Build the OSC 99 sequence
    // u=urgency: 0=low, 1=normal (default), 2=critical
    const urgencyParam = urgency === 'low' ? 'u=0' : urgency === 'critical' ? 'u=2' : '';
    const params = `i=${id}${urgencyParam ? `;${urgencyParam}` : ''}`;

    // Title chunk (d=0 means title)
    const titleSeq = `\u001B]99;${params};d=0;${escapeOsc(title)}\u001B\\`;

    if (body) {
      // Body chunk (d=1 means body, same id links them)
      const bodySeq = `\u001B]99;i=${id};d=1;${escapeOsc(body)}\u001B\\`;
      process.stdout.write(titleSeq + bodySeq);
    } else {
      process.stdout.write(titleSeq);
    }
  } catch {
    // Silently ignore — notification is best-effort
  }
}

/**
 * Notify that the agent turn completed.
 */
export function notifyTurnComplete(summary?: string): void {
  ringBell();
  sendDesktopNotification({
    title: ttui('tui.notification.turnComplete.title'),
    body: summary ?? ttui('tui.notification.turnComplete.body'),
    urgency: 'normal',
  });
}

/**
 * Notify that the agent encountered an error.
 */
export function notifyError(message: string): void {
  ringBell();
  sendDesktopNotification({
    title: ttui('tui.notification.error.title'),
    body: message.slice(0, 200),
    urgency: 'critical',
  });
}

/**
 * Notify that the agent needs user input (e.g. permission request).
 */
export function notifyNeedsAttention(context: string): void {
  sendDesktopNotification({
    title: ttui('tui.notification.attention.title'),
    body: context.slice(0, 200),
    urgency: 'normal',
  });
}

/**
 * Notify that a background Conductor job reached a terminal status. Rings
 * the bell too — job awareness previously depended on the user staring at
 * the footer strip.
 */
export function notifyJobOutcome(input: {
  readonly status: 'done' | 'failed' | 'needs_user' | 'blocked';
  readonly title: string;
  readonly detail?: string;
}): void {
  ringBell();
  const title =
    input.status === 'done'
      ? ttui('tui.notification.jobDone.title')
      : input.status === 'failed'
        ? ttui('tui.notification.jobFailed.title')
        : ttui('tui.notification.jobAttention.title');
  const body =
    input.status === 'done'
      ? ttui('tui.notification.jobDone.body', { title: input.title })
      : input.status === 'failed'
        ? ttui('tui.notification.jobFailed.body', { title: input.title })
        : ttui('tui.notification.jobAttention.body', { title: input.title });
  sendDesktopNotification({
    title,
    body:
      input.detail !== undefined && input.detail.length > 0
        ? `${body} — ${input.detail.slice(0, 140)}`
        : body,
    urgency: input.status === 'failed' ? 'critical' : 'normal',
  });
}

/** Escape special characters for OSC payload. */
function escapeOsc(text: string): string {
  return text.replaceAll(/[\u001B\u0007]/g, '').replaceAll(';', ',');
}

/**
 * Ring the terminal bell (BEL character).
 * Provides audio feedback when the agent needs attention.
 */
export function ringBell(): void {
  try {
    process.stdout.write('\u0007');
  } catch {
    // Silently ignore
  }
}
