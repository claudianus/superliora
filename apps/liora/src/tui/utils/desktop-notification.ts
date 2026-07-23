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
    title: 'SuperLiora — 작업 완료',
    body: summary ?? '에이전트 응답이 완료됐어요.',
    urgency: 'normal',
  });
}

/**
 * Notify that the agent encountered an error.
 */
export function notifyError(message: string): void {
  ringBell();
  sendDesktopNotification({
    title: 'SuperLiora — 오류',
    body: message.slice(0, 200),
    urgency: 'critical',
  });
}

/**
 * Notify that the agent needs user input (e.g. permission request).
 */
export function notifyNeedsAttention(context: string): void {
  sendDesktopNotification({
    title: 'SuperLiora — 확인 필요',
    body: context.slice(0, 200),
    urgency: 'normal',
  });
}

/** Escape special characters for OSC payload. */
function escapeOsc(text: string): string {
  return text.replace(/[\u001B\u0007]/g, '').replace(/;/g, ',');
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
