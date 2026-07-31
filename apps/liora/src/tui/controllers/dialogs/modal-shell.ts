import type { Component, Focusable } from '#/tui/renderer';

import { CommandHubComponent } from '../../components/dialogs/command-hub/index';
import type { CenterModalMountOptions } from '../../utils/ui/center-modal';
import {
  flushSuppressedTUIFrame,
  requestTUIContentRender,
  requestTUILayoutRender,
} from '../../utils/render/frame-render';
import { ttui } from '../../utils/tui-i18n';
import type { DialogsHost } from './types';

export interface ModalShellDelegate {
  closeAllCenterModals(): void;
  refreshOpenCommandHub(): void;
}

export function mountEditorReplacement(
  host: DialogsHost,
  delegate: ModalShellDelegate,
  panel: Component & Focusable,
): void {
  // Center modals own the input stack — close them before editor takeover.
  if (host.state.centerModalStack.length > 0) delegate.closeAllCenterModals();
  host.state.editorContainer.clear();
  host.state.editorContainer.addChild(panel);
  host.state.ui.setFocus(panel);
  mountNativeInputModal(host, panel);
  // Track that a command-driven dialog owns the editor area so background
  // approval/question events do not clobber it mid-flow (BUG-7). Help and
  // session-picker set their own specific dialog id after this call.
  // Keep session-loading sticky so restore paths cannot silently drop the lock.
  host.state.activeDialog ??= 'command';
  requestTUIContentRender(host.state);
}

/**
 * Float a PREMIUM panel in the viewport center (Command Hub, Settings, …).
 * Does not replace the editor strip. See PREMIUM.md §8.2.
 */
export function mountCenterModal(
  host: DialogsHost,
  delegate: ModalShellDelegate,
  panel: Component & Focusable,
  options: CenterModalMountOptions = {},
): void {
  const mode = options.mode ?? 'push';
  if (mode === 'replace' && host.state.centerModalStack.length > 0) {
    closeCenterModal(host, delegate);
  }
  // Block only true full-page takeovers (not center-modal dialog ids).
  switch (host.state.activeDialog) {
    case 'session-loading':
    case 'files':
    case 'file-viewer':
    case 'diff-review':
    case 'commit-browser':
    case 'blame':
    case 'error-navigator':
    case 'search':
    case 'agent-dashboard':
      return;
    default:
      break;
  }
  const inputRouter = host.nativeInputRouter;
  if (inputRouter === undefined || panel.handleInput === undefined) return;
  const id = `center-modal:${String(++host.centerModalSequence)}`;
  const handleInput = panel.handleInput.bind(panel);
  const disposeInput = inputRouter.pushLegacyModalTarget(
    {
      id,
      handleInput: (data) => {
        handleInput(data);
      },
    },
    { restoreFocus: false },
  );
  host.state.centerModalStack.push({
    id,
    panel,
    disposeInput,
    label: options.label,
  });
  host.state.activeDialog = 'center-modal';
  host.state.ui.setFocus(panel);
  requestTUIContentRender(host.state);
}

/** Pop the top center modal. Restores editor focus when the stack is empty. */
export function closeCenterModal(host: DialogsHost, delegate: ModalShellDelegate): void {
  const top = host.state.centerModalStack.pop();
  if (top === undefined) return;
  if (top.panel === host.openCommandHub) {
    host.openCommandHub = undefined;
  }
  top.disposeInput();
  if (host.state.centerModalStack.length === 0) {
    clearCenterModalDialogMarker(host);
    host.nativeInputRouter?.focusEditor();
    host.state.ui.setFocus(host.state.editor);
    flushDeferredReverseRpcPanels(host);
  } else {
    const next = host.state.centerModalStack.at(-1)!;
    host.state.ui.setFocus(next.panel);
    if (next.panel instanceof CommandHubComponent) {
      delegate.refreshOpenCommandHub();
    }
  }
  requestTUIContentRender(host.state);
}

export function closeAllCenterModals(host: DialogsHost): void {
  while (host.state.centerModalStack.length > 0) {
    const top = host.state.centerModalStack.pop();
    top?.disposeInput();
  }
  host.openCommandHub = undefined;
  clearCenterModalDialogMarker(host);
  host.nativeInputRouter?.focusEditor();
  host.state.ui.setFocus(host.state.editor);
  requestTUIContentRender(host.state);
  flushDeferredReverseRpcPanels(host);
}

function clearCenterModalDialogMarker(host: DialogsHost): void {
  switch (host.state.activeDialog) {
    case 'center-modal':
    case 'help':
    case 'extensions':
    case 'session-picker':
      host.state.activeDialog = null;
      break;
    default:
      break;
  }
}

function flushDeferredReverseRpcPanels(host: DialogsHost): void {
  const approval = host.deferredApproval;
  if (approval !== undefined) {
    host.deferredApproval = undefined;
    host.showApprovalPanel(approval);
    return;
  }
  const question = host.deferredQuestion;
  if (question !== undefined) {
    host.deferredQuestion = undefined;
    host.showQuestionDialog(question);
  }
}

export function restoreEditor(host: DialogsHost): void {
  // Never restore the free editor while history is still loading.
  if (host.sessionLoadingOverlay !== undefined) {
    host.state.editorContainer.clear();
    host.state.editorContainer.addChild(host.sessionLoadingOverlay);
    host.state.ui.setFocus(host.sessionLoadingOverlay);
    mountNativeInputModal(host, host.sessionLoadingOverlay);
    host.state.activeDialog = 'session-loading';
    requestTUIContentRender(host.state);
    return;
  }
  host.state.editorContainer.clear();
  host.state.editorContainer.addChild(host.state.editor);
  host.state.ui.setFocus(host.state.editor);
  host.nativeInputModalDispose?.();
  host.nativeInputModalDispose = undefined;
  host.nativeInputRouter?.focusEditor();
  // Only clear a generic command-dialog marker. Help/session-picker/
  // agent-dashboard manage their own `activeDialog` lifecycle and may
  // already be null here.
  if (host.state.activeDialog === 'command' || host.state.activeDialog === 'session-loading') {
    host.state.activeDialog = null;
  }
  requestTUIContentRender(host.state);
  // Flush any reverse-RPC panel that was deferred while a command dialog was
  // open (BUG-7). Approval takes priority, then question.
  const approval = host.deferredApproval;
  if (approval !== undefined) {
    host.deferredApproval = undefined;
    host.showApprovalPanel(approval);
    return;
  }
  const question = host.deferredQuestion;
  if (question !== undefined) {
    host.deferredQuestion = undefined;
    host.showQuestionDialog(question);
  }
}

function mountNativeInputModal(host: DialogsHost, panel: Component & Focusable): void {
  const inputRouter = host.nativeInputRouter;
  if (inputRouter === undefined || panel.handleInput === undefined) return;
  host.nativeInputModalDispose?.();
  const id = `editor-replacement:${String(++host.nativeInputModalSequence)}`;
  const handleInput = panel.handleInput.bind(panel);
  host.nativeInputModalDispose = inputRouter.pushLegacyModalTarget({
    id,
    handleInput: (data) => {
      handleInput(data);
    },
  });
}

export function restoreInputText(
  host: DialogsHost,
  delegate: ModalShellDelegate,
  text: string,
): void {
  restoreEditor(host);
  host.state.editor.setText(text);
  host.updateEditorBorderHighlight(text);
  requestTUIContentRender(host.state);
}

/** Ctrl-X: stash the current draft, or pop the latest stash when the editor is empty. */
export function stashPromptToggle(host: DialogsHost, delegate: ModalShellDelegate): void {
  const editor = host.state.editor;
  const text = editor.getText();
  if (text.trim().length > 0) {
    host.promptStash.push({ text, mode: editor.inputMode });
    editor.setText('');
    host.updateEditorBorderHighlight('');
    host.showStatus(ttui('tui.stash.stashed', { count: String(host.promptStash.size) }));
    requestTUIContentRender(host.state);
    return;
  }
  const entry = host.promptStash.pop();
  if (entry === undefined) {
    host.showStatus(ttui('tui.stash.empty'));
    return;
  }
  restoreInputText(host, delegate, entry.text);
  // Restore the stashed mode like queue recall does, so a draft saved in
  // shell mode comes back ready to run as a `!` command.
  const mode = entry.mode;
  if (editor.inputMode !== mode) {
    editor.inputMode = mode;
    editor.onInputModeChange?.(mode);
  }
  host.updateQueueDisplay();
  requestTUILayoutRender(host.state);
  host.showStatus(ttui('tui.stash.restored', { count: String(host.promptStash.size) }));
}
