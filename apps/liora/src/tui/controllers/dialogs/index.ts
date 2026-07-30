import type { Component, Focusable } from '#/tui/renderer';

import type { SessionLoadingPhase } from '../../components/dialogs/session-loading-overlay';
import type { CenterModalMountOptions } from '../../utils/center-modal';
import {
  refreshOpenCommandHub,
  showCommandHub,
  showCommandPalette,
  showCommandPaletteOmnibox,
} from './command-hub';
import { showHelpPanel } from './help';
import {
  closeAllCenterModals,
  closeCenterModal,
  mountCenterModal,
  mountEditorReplacement,
  restoreEditor,
  restoreInputText,
  stashPromptToggle,
} from './modal-shell';
import {
  scrollToTranscriptIndex,
  showHistorySearch,
  showTranscriptSearch,
} from './search';
import {
  beginSessionLoading,
  endSessionLoading,
  isSessionLoadingOverlayActive,
  reportSessionLoading,
  runWithBusyOverlay,
  stopSessionLoadingPulse,
} from './session-loading';
import type { DialogsHost } from './types';

export type { DialogsHost } from './types';

/**
 * Dialog-mounting shell (editor-replacement / center-modal mechanics, session
 * loading overlay, prompt stash) plus the Command Hub, command palette,
 * history search, transcript search, and help-panel entry points.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class DialogsController {
  constructor(private readonly host: DialogsHost) {}

  isSessionLoadingOverlayActive(): boolean {
    return isSessionLoadingOverlayActive(this.host);
  }

  beginSessionLoading(sessionId?: string, title?: string): void {
    beginSessionLoading(this.host, this, sessionId, title);
  }

  reportSessionLoading(patch: {
    readonly phase?: SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void {
    reportSessionLoading(this.host, patch);
  }

  endSessionLoading(): void {
    endSessionLoading(this.host, this);
  }

  async runWithBusyOverlay<T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: SessionLoadingPhase;
    },
    work: () => Promise<T> | T,
  ): Promise<T> {
    return runWithBusyOverlay(this.host, this, options, work);
  }

  stopSessionLoadingPulse(): void {
    stopSessionLoadingPulse(this.host);
  }

  mountEditorReplacement(panel: Component & Focusable): void {
    mountEditorReplacement(this.host, this, panel);
  }

  mountCenterModal(panel: Component & Focusable, options: CenterModalMountOptions = {}): void {
    mountCenterModal(this.host, this, panel, options);
  }

  closeCenterModal(): void {
    closeCenterModal(this.host, this);
  }

  closeAllCenterModals(): void {
    closeAllCenterModals(this.host);
  }

  restoreEditor(): void {
    restoreEditor(this.host);
  }

  restoreInputText(text: string): void {
    restoreInputText(this.host, this, text);
  }

  stashPromptToggle(): void {
    stashPromptToggle(this.host, this);
  }

  showHistorySearch(): void {
    showHistorySearch(this.host, this);
  }

  showCommandPalette(): void {
    showCommandPalette(this);
  }

  showCommandPaletteOmnibox(): void {
    showCommandPaletteOmnibox(this.host, this);
  }

  showCommandHub(options: { readonly initialQuery?: string; readonly intro?: boolean } = {}): void {
    showCommandHub(this.host, this, options);
  }

  refreshOpenCommandHub(): void {
    refreshOpenCommandHub(this.host);
  }

  showTranscriptSearch(): void {
    showTranscriptSearch(this.host, this);
  }

  scrollToTranscriptIndex(index: number): void {
    scrollToTranscriptIndex(this.host, index);
  }

  showHelpPanel(args = ''): void {
    showHelpPanel(this.host, this, args);
  }
}
