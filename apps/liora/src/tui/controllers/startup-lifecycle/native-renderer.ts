import {
  encodeNativeInputAsLegacySequence,
  LioraNativeRootUI,
  type NativeInputEvent,
  type NativeInputKey,
} from '#/tui/renderer';
import { ensureFdPath } from '#/utils/process/fd-detect';

import type { TodoBoardScrollAction } from '../../components/chrome/todo/todo-panel';
import type { MissionWorkerScrollAction } from '../../components/panes/mission-control/panel';
import { setKittyGraphicsChannel } from '../../media/kitty-graphics-channel';
import {
  requestTUIContentRender,
  requestTUILayoutRender,
} from '../../utils/render/frame-render';
import {
  createTUIStateNativeInputRouter,
  type TUIStateNativeInputRouter,
} from '../../features/native-layout/native-input-router';
import { createTUIStateNativeRenderCallback } from '../../features/native-layout/native-layout-frame';
import { handleFooterJobsStripMouse } from '../../features/control-tower/footer-jobs-mouse';
import { focusIntentComposer } from '../../features/control-tower/conductor-ux';
import { handleWorkerDockMouse } from '../../features/mission-control/worker-dock-mouse';
import { installTerminalFocusTracking } from '../../utils/terminal/terminal-focus';
import {
  getTUIStateNativeMissionRect,
  getTUIStateNativeTodoRect,
} from '../../features/transcript/transcript-hit-test';
import type { TranscriptScrollAction } from '../../features/transcript/transcript-viewport';
import { openWorkerTranscript } from '../../commands/worker-transcript';
import { ClipboardImageHintController } from '../clipboard/clipboard-image-hint';
import type { StartupLifecycleHost } from './types';
import { ttui } from '../../utils/tui-i18n';
import type { SlashCommandHost } from '../../commands/hub/dispatch';
import { missionBandActive } from '../../features/mission-control/dock';
import { requestTUIContentRender as requestContentRender } from '../../utils/render/frame-render';

export interface StartupNativeRendererCallbacks {
  scrollTranscriptViewport(action: TranscriptScrollAction): boolean;
}

export function attachStartupNativeRendererCallback(host: StartupLifecycleHost): void {
  if (!(host.state.ui instanceof LioraNativeRootUI)) return;
  const nativeRootUI = host.state.ui;
  if (host.nativeInputRouter !== undefined) {
    nativeRootUI.setInputRouter(host.nativeInputRouter.router);
  }
  const diagnosticsOverlay = () => host.nativeRendererDiagnosticsHudEnabled;
  nativeRootUI.setRenderCallback(
    createTUIStateNativeRenderCallback(host.state, {
      diagnosticsOverlay,
      onAuthoritativeFrame: () => {
        host.appearanceController.reapplyTerminalPalette();
      },
    }),
  );
  host.state.toast.onChanged = () => {
    nativeRootUI.renderer.requestRender('manual');
  };
}

export function ensureStartupNativeInputRouter(
  host: StartupLifecycleHost,
  callbacks: StartupNativeRendererCallbacks,
): void {
  if (host.nativeInputRouter !== undefined) return;
  host.nativeInputRouter = createTUIStateNativeInputRouter(host.state, {
    scrollTranscriptViewport: (action) => callbacks.scrollTranscriptViewport(action),
    scrollTodoPanel: (event) => scrollStartupTodoPanelAtMouse(host, event),
    scrollMissionPanel: (event) => scrollStartupMissionPanelAtMouse(host, event),
    handlePreEditorInput: (event) => {
      if (event.type !== 'key' || event.eventType === 'release') return false;
      if (event.alt && scrollStartupTodoPanelByKey(host, event.key)) return true;
      // Alt+↑/↓ still window-scrolls the dock; bare ↑/↓ select when a row is focused.
      if (event.alt && scrollStartupMissionPanelByKey(host, event.key)) return true;
      if (handleMissionDockSelectionKey(host, event.key)) return true;
      // Native Alt+J / Alt+I (Kitty CSI-u / ESC+letter). Also mirrored via
      // tryHandleAppShortcut → editor.onOpenJobDeck / onOpenJobInbox.
      if (
        event.alt &&
        event.key === 'character' &&
        event.text !== undefined
      ) {
        const letter = event.text.toLowerCase();
        if (letter === 'j') return openJobDeckFromShortcut(host);
        if (letter === 'i') return openJobInboxFromShortcut(host);
        if (letter === 'b') {
          return focusIntentComposer({
            state: host.state,
            session: host.session,
            showStatus: (msg, color) => host.showStatus(msg, color),
            jobBoardController: host.jobBoardController,
          });
        }
      }
      const legacy = encodeNativeInputAsLegacySequence(event);
      if (legacy === undefined) return false;
      return host.state.editor.tryHandleAppShortcut?.(legacy) === true;
    },
  });
  // F07: footer Conductor jobs strip click → Inbox (unread) or Job Deck.
  host.nativeInputRouter.router.registerGlobalHandler({
    id: 'footer-conductor-jobs',
    onInput: (event) =>
      handleFooterJobsStripMouse(
        {
          state: host.state,
          openJobDeck: () => {
            host.jobBoardController.openDeck();
          },
          openJobInbox: () => {
            host.openJobInbox?.();
          },
        },
        event,
      ),
  });
  // Worker Dock: hover highlight + click-to-open transcript.
  host.nativeInputRouter.router.registerGlobalHandler({
    id: 'mission-worker-dock',
    onInput: (event) =>
      handleWorkerDockMouse(
        {
          state: host.state,
          openWorkerTranscript: (workerId) => openWorkerTranscriptFromDock(host, workerId),
        },
        event,
      ),
  });
}

/** Shared by native Alt+J and the editor app-shortcut path (matchesKey). */
export function openJobDeckFromShortcut(host: StartupLifecycleHost): boolean {
  const jobs = host.state.appState.conductorJobs?.jobs ?? [];
  if (jobs.length === 0) {
    host.showStatus(ttui('tui.session.noJobsYet'), 'textMuted');
    return true;
  }
  host.jobBoardController.openDeck();
  return true;
}

/** Shared by native Alt+I and the editor app-shortcut path (matchesKey). */
export function openJobInboxFromShortcut(host: StartupLifecycleHost): boolean {
  host.openJobInbox?.();
  return true;
}

export function stopStartupNativeRendererAdapters(host: StartupLifecycleHost): void {
  host.nativeInputModalDispose?.();
  host.nativeInputModalDispose = undefined;
  host.nativeInputRouter?.dispose();
  host.nativeInputRouter = undefined;
}

export function startStartupClipboardImageHintController(host: StartupLifecycleHost): void {
  host.clipboardImageHintController = new ClipboardImageHintController({
    ui: host.state.ui,
    footer: host.state.footer,
    getModelSupportsImage: () => host.appStateController.supportsCurrentModelCapability('image_in'),
    requestRender: () => {
      requestTUIContentRender(host.state);
    },
  });
  host.clipboardImageHintController.start();
}

export function startStartupEventLoop(
  host: StartupLifecycleHost,
  callbacks: StartupNativeRendererCallbacks,
): void {
  host.state.renderer.start();
  setKittyGraphicsChannel((sequence) => {
    host.state.terminal.write(sequence);
  });
  host.eventLoopStarted = true;
  ensureStartupNativeInputRouter(host, callbacks);
  attachStartupNativeRendererCallback(host);
  startStartupClipboardImageHintController(host);
  host.terminalFocusTrackingDispose = installTerminalFocusTracking(host.state);
  host.refreshTerminalThemeTracking();
}

export function disposeStartupTerminalTracking(host: StartupLifecycleHost): void {
  stopStartupNativeRendererAdapters(host);
  setKittyGraphicsChannel(undefined);
  host.eventLoopStarted = false;
  host.panes.stopTerminalThemeTracking();
  host.clipboardImageHintController?.stop();
  host.clipboardImageHintController = undefined;
  host.terminalFocusTrackingDispose?.();
  host.terminalFocusTrackingDispose = undefined;
}

export function startStartupBackgroundFdAutocomplete(host: StartupLifecycleHost): void {
  if (host.fdPath !== null || host.fdDownloadStarted) return;
  host.fdDownloadStarted = true;

  void ensureFdPath()
    .then((fdPath) => {
      if (fdPath === null) return;
      host.fdPath = fdPath;
      host.setupAutocomplete();
    })
    .catch(() => {});
}

export function mountStartupFooter(host: StartupLifecycleHost): void {
  if (!host.state.footerContainer.children.includes(host.state.footer)) {
    host.state.footerContainer.addChild(host.state.footer);
  }
  if (!host.state.ui.children.includes(host.state.footerContainer)) {
    host.state.ui.addChild(host.state.footerContainer);
  }
}

export function mountStartupHeader(host: StartupLifecycleHost): void {
  if (!host.state.headerContainer.children.includes(host.state.header)) {
    host.state.headerContainer.addChild(host.state.header);
  }
  if (!host.state.ui.children.includes(host.state.headerContainer)) {
    host.state.ui.addChild(host.state.headerContainer);
  }
}

function scrollStartupTodoPanelAtMouse(host: StartupLifecycleHost, event: NativeInputEvent): boolean {
  if (event.type !== 'mouse') return false;
  const rect = getTUIStateNativeTodoRect(host.state);
  if (rect === undefined) return false;
  if (
    event.x < rect.x ||
    event.x >= rect.x + rect.width ||
    event.y < rect.y ||
    event.y >= rect.y + rect.height
  ) {
    return false;
  }
  const action: TodoBoardScrollAction | undefined =
    event.button === 'wheel-up'
      ? 'line-up'
      : event.button === 'wheel-down'
        ? 'line-down'
        : undefined;
  if (action === undefined) return false;
  if (!host.state.todoPanel.scrollBoard(action)) return false;
  requestTUILayoutRender(host.state);
  return true;
}

function scrollStartupTodoPanelByKey(host: StartupLifecycleHost, key: NativeInputKey): boolean {
  let action: TodoBoardScrollAction | undefined;
  switch (key) {
    case 'up':
      action = 'line-up';
      break;
    case 'down':
      action = 'line-down';
      break;
    case 'pageup':
      action = 'page-up';
      break;
    case 'pagedown':
      action = 'page-down';
      break;
    case 'home':
      action = 'top';
      break;
    case 'end':
      action = 'bottom';
      break;
    default:
      return false;
  }
  if (!host.state.todoPanel.scrollBoard(action)) return false;
  requestTUILayoutRender(host.state);
  return true;
}

function scrollStartupMissionPanelAtMouse(
  host: StartupLifecycleHost,
  event: NativeInputEvent,
): boolean {
  if (event.type !== 'mouse') return false;
  const rect = getTUIStateNativeMissionRect(host.state);
  if (rect === undefined) return false;
  if (
    event.x < rect.x ||
    event.x >= rect.x + rect.width ||
    event.y < rect.y ||
    event.y >= rect.y + rect.height
  ) {
    return false;
  }
  const action: MissionWorkerScrollAction | undefined =
    event.button === 'wheel-up'
      ? 'line-up'
      : event.button === 'wheel-down'
        ? 'line-down'
        : undefined;
  if (action === undefined) return false;
  if (!host.state.missionControlPanel.scrollWorkers(action)) return false;
  requestTUILayoutRender(host.state);
  return true;
}

function scrollStartupMissionPanelByKey(
  host: StartupLifecycleHost,
  key: NativeInputKey,
): boolean {
  let action: MissionWorkerScrollAction | undefined;
  switch (key) {
    case 'up':
      action = 'line-up';
      break;
    case 'down':
      action = 'line-down';
      break;
    case 'pageup':
      action = 'page-up';
      break;
    case 'pagedown':
      action = 'page-down';
      break;
    case 'home':
      action = 'top';
      break;
    case 'end':
      action = 'bottom';
      break;
    default:
      return false;
  }
  if (!host.state.missionControlPanel.scrollWorkers(action)) return false;
  requestTUILayoutRender(host.state);
  return true;
}

/**
 * Bare ↑/↓/Enter/Esc when the Worker Dock is active:
 * - with a selection (or workers present): ↑↓ move selection, Enter opens, Esc clears
 * - without workers: fall through to editor
 */
function handleMissionDockSelectionKey(
  host: StartupLifecycleHost,
  key: NativeInputKey,
): boolean {
  if (!missionBandActive(host.state)) return false;
  const panel = host.state.missionControlPanel;
  if (panel.isEmpty()) return false;

  const mapKey =
    key === 'up' ||
    key === 'down' ||
    key === 'enter' ||
    key === 'escape' ||
    key === 'pageup' ||
    key === 'pagedown' ||
    key === 'home' ||
    key === 'end'
      ? key
      : undefined;
  if (mapKey === undefined) return false;

  // Esc / Enter only when a selection exists (or Enter can create one).
  if (mapKey === 'escape' && panel.selectedWorker === undefined) return false;
  if (
    (mapKey === 'up' || mapKey === 'down') &&
    panel.selectedWorker === undefined &&
    panel.currentView.snapshot.workers.length === 0
  ) {
    return false;
  }
  // Without an existing selection, only consume ↑/↓ when Alt is not held
  // and the operator has already focused the dock via mouse hover/click —
  // otherwise bare arrows stay with the editor. Once selected, arrows stay
  // on the dock until Esc.
  if (
    (mapKey === 'up' || mapKey === 'down') &&
    panel.selectedWorker === undefined
  ) {
    // First arrow focuses the dock roster without stealing when empty.
    const result = panel.handleSelectionKey(mapKey);
    if (!result.handled) return false;
    requestContentRender(host.state);
    return true;
  }

  const result = panel.handleSelectionKey(mapKey);
  if (!result.handled) return false;
  if (result.openWorkerId !== undefined) {
    openWorkerTranscriptFromDock(host, result.openWorkerId);
  }
  requestContentRender(host.state);
  return true;
}

function openWorkerTranscriptFromDock(
  host: StartupLifecycleHost,
  workerId: string,
): void {
  // LioraTUI implements SlashCommandHost; cast through the host surface.
  openWorkerTranscript(host as unknown as SlashCommandHost, workerId);
}

export type { TUIStateNativeInputRouter };
