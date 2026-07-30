import type { Component, Focusable } from '#/tui/renderer';

import { SessionLoadingOverlayComponent } from '../../components/dialogs/session-loading-overlay';
import type { SessionLoadingPhase } from '../../components/dialogs/session-loading-overlay';
import { flushSuppressedTUIFrame } from '../../utils/render/frame-render';
import { ttui } from '../../utils/tui-i18n';
import type { DialogsHost } from './types';

export interface SessionLoadingShell {
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
}

export function isSessionLoadingOverlayActive(host: DialogsHost): boolean {
  return host.sessionLoadingOverlay !== undefined;
}

export function beginSessionLoading(
  host: DialogsHost,
  shell: SessionLoadingShell,
  sessionId?: string,
  title?: string,
): void {
  host.setAppState({ isReplaying: true });
  if (host.sessionLoadingOverlay !== undefined) {
    reportSessionLoading(host, {
      phase: 'opening',
      progress: 0.08,
      sessionId,
      title,
      detail: ttui('tui.sessionLoading.phase.opening'),
    });
    return;
  }
  // Drop any open picker/dashboard so a second resume cannot start mid-load.
  if (
    host.state.activeDialog === 'session-picker' ||
    host.state.activeDialog === 'agent-dashboard' ||
    host.state.activeDialog === 'command' ||
    host.state.activeDialog === 'help' ||
    host.state.activeDialog === 'search'
  ) {
    host.state.activeDialog = null;
  }
  const overlay = new SessionLoadingOverlayComponent({
    sessionId,
    title,
    phase: 'opening',
    progress: 0.08,
    detail: ttui('tui.sessionLoading.phase.opening'),
  });
  host.sessionLoadingOverlay = overlay;
  host.state.activeDialog = 'session-loading';
  shell.mountEditorReplacement(overlay);
  startSessionLoadingPulse(host);
  // Paint immediately so the user never sees a silent freeze.
  flushSuppressedTUIFrame(host.state, 'layout');
}

export function reportSessionLoading(
  host: DialogsHost,
  patch: {
    readonly phase?: SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  },
): void {
  const overlay = host.sessionLoadingOverlay;
  if (overlay === undefined) return;
  overlay.update(patch);
  // Mid-hydrate content frames are suppressed by batch mount; force a layout
  // paint so the modal spinner/bar stay alive.
  flushSuppressedTUIFrame(host.state, 'layout');
}

export function endSessionLoading(host: DialogsHost, shell: SessionLoadingShell): void {
  stopSessionLoadingPulse(host);
  host.sessionLoadingOverlay = undefined;
  host.setAppState({ isReplaying: false });
  if (host.state.activeDialog === 'session-loading') {
    host.state.activeDialog = null;
    shell.restoreEditor();
  } else {
    // Overlay was already replaced; still force a final layout paint.
    flushSuppressedTUIFrame(host.state, 'layout');
  }
}

export async function runWithBusyOverlay<T>(
  host: DialogsHost,
  shell: SessionLoadingShell,
  options: {
    readonly title?: string;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly phase?: SessionLoadingPhase;
  },
  work: () => Promise<T> | T,
): Promise<T> {
  const already = isSessionLoadingOverlayActive(host);
  if (!already) {
    beginSessionLoading(host, shell, options.sessionId, options.title);
  }
  reportSessionLoading(host, {
    phase: options.phase ?? 'working',
    detail: options.detail ?? ttui('tui.sessionLoading.phase.working'),
    sessionId: options.sessionId,
    title: options.title,
  });
  // Let the modal paint before potentially-blocking work.
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    return await work();
  } finally {
    if (!already) {
      endSessionLoading(host, shell);
    }
  }
}

export function startSessionLoadingPulse(host: DialogsHost): void {
  stopSessionLoadingPulse(host);
  host.sessionLoadingPulseTimer = setInterval(() => {
    if (host.sessionLoadingOverlay === undefined) {
      stopSessionLoadingPulse(host);
      return;
    }
    flushSuppressedTUIFrame(host.state, 'content');
  }, 100);
}

/** Also called directly from `LioraTUI#stop` during shutdown. */
export function stopSessionLoadingPulse(host: DialogsHost): void {
  if (host.sessionLoadingPulseTimer === undefined) return;
  clearInterval(host.sessionLoadingPulseTimer);
  host.sessionLoadingPulseTimer = undefined;
}
