import type { Session } from '@superliora/sdk';

import type { LioraSlashCommand, SlashCommandHelpMode } from '../../commands';
import { CommandHubComponent } from '../../components/dialogs/command-hub';
import { SessionLoadingOverlayComponent } from '../../components/dialogs/session-loading-overlay';
import type { ApprovalPanelData, QuestionPanelData } from '../../reverse-rpc/types';
import type { ColorToken } from '../../theme';
import type { TUIState } from '../../tui-state';
import type { AppState } from '../../types';
import type { TUIStateNativeInputRouter } from '../../features/native-layout/native-input-router';
import type { PromptStash } from '../../utils/prompt-stash';

export function helpModeFromArgs(args: string): SlashCommandHelpMode {
  const normalized = args.trim().toLowerCase();
  if (normalized === 'diagnostics' || normalized === 'diagnostic' || normalized === 'internal') {
    return 'diagnostics';
  }
  return normalized === 'advanced' || normalized === 'manual' ? 'advanced' : 'primary';
}

/**
 * Host surface required by the dialog-mounting shell (editor-replacement /
 * center-modal mechanics, session-loading overlay, prompt stash) and the
 * Command Hub / palette / history / transcript search entry points.
 */
export interface DialogsHost {
  state: TUIState;
  session: Session | undefined;
  readonly promptStash: PromptStash;
  skillCommands: readonly LioraSlashCommand[];
  nativeInputRouter: TUIStateNativeInputRouter | undefined;
  nativeInputModalDispose: (() => void) | undefined;
  nativeInputModalSequence: number;
  centerModalSequence: number;
  openCommandHub: CommandHubComponent | undefined;
  deferredApproval: ApprovalPanelData | undefined;
  deferredQuestion: QuestionPanelData | undefined;
  sessionLoadingOverlay: SessionLoadingOverlayComponent | undefined;
  sessionLoadingPulseTimer: ReturnType<typeof setInterval> | undefined;

  setAppState(patch: Partial<AppState>): void;
  showStatus(message: string, color?: ColorToken): void;
  updateEditorBorderHighlight(text?: string): void;
  updateQueueDisplay(): void;
  showApprovalPanel(payload: ApprovalPanelData): void;
  showQuestionDialog(payload: QuestionPanelData): void;
  cancelRunningShellCommand(): void;
  getSlashCommands(mode?: SlashCommandHelpMode): readonly LioraSlashCommand[];
  dispatchSlash(command: string): void;
}
