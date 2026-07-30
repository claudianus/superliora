import type { Component, Focusable } from '#/tui/renderer';

import {
  ApprovalPanelComponent,
  type ApprovalPanelResponse,
} from '../components/dialogs/approval/approval-panel';
import {
  ApprovalPreviewViewer,
  type ApprovalPreviewBlock,
} from '../components/dialogs/approval/approval-preview';
import { QuestionDialogComponent } from '../components/dialogs/question/question-dialog';
import { adaptPanelResponse } from '../reverse-rpc/approval/adapter';
import type { ApprovalController } from '../reverse-rpc/approval/controller';
import type { QuestionController } from '../reverse-rpc/question/controller';
import type { ApprovalPanelData, QuestionPanelData } from '../reverse-rpc/types';
import type { TUIState } from '../tui-state';
import type { LivePaneState } from '../types';
import { requestTUILayoutRender } from '../utils/render/frame-render';
import { notifyUserAttentionOnce } from '../utils/terminal/terminal-notification';

/** Host surface for SDK approval and question panel mounting. */
export interface ReverseRpcPanelsHost {
  state: TUIState;
  deferredApproval: ApprovalPanelData | undefined;
  deferredQuestion: QuestionPanelData | undefined;
  readonly approvalController: ApprovalController;
  readonly questionController: QuestionController;
  readonly reverseRpcDisposers: Array<() => void>;

  patchLivePane(patch: Partial<LivePaneState>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  toggleToolOutputExpansion(): void;
}

/**
 * Approval and question dialog mounting, deferral, and preview viewer.
 * LioraTUI keeps thin public delegates so reverse-rpc wiring stays stable.
 */
export class ReverseRpcPanelsController {
  private activeApprovalPanel: ApprovalPanelComponent | undefined;
  private approvalPreview:
    | {
        component: ApprovalPreviewViewer;
        savedChildren: (typeof this.host.state.ui.children)[number][];
        panel: ApprovalPanelComponent;
      }
    | undefined;

  constructor(private readonly host: ReverseRpcPanelsHost) {}

  clearReverseRpcPanels(): void {
    for (const dispose of this.host.reverseRpcDisposers) {
      dispose();
    }
  }

  cancelPendingReverseRpc(reason: string): void {
    this.host.approvalController.cancelAll(reason);
    this.host.questionController.cancelAll(reason);
  }

  showApprovalPanel(payload: ApprovalPanelData): void {
    if (
      this.host.state.activeDialog === 'command' ||
      this.host.state.activeDialog === 'center-modal' ||
      this.host.state.centerModalStack.length > 0
    ) {
      this.host.deferredApproval = payload;
      return;
    }
    this.host.patchLivePane({ pendingApproval: { data: payload } });
    notifyUserAttentionOnce(this.host.state, `approval:${payload.id}`, {
      title: 'SuperLiora approval required',
      body: payload.tool_name,
    });
    const panel = new ApprovalPanelComponent(
      { data: payload },
      (response: ApprovalPanelResponse) => {
        const planFromDisplay = payload.display
          .filter((block): block is { type: 'brief'; text: string } => block.type === 'brief')
          .map((block) => block.text)
          .join('\n');
        this.host.approvalController.respond(
          adaptPanelResponse(response, {
            plan: planFromDisplay.length > 0 ? planFromDisplay : undefined,
          }),
        );
      },
      () => {
        this.host.toggleToolOutputExpansion();
      },
      (block) => {
        this.openApprovalPreview(panel, block);
      },
    );
    this.activeApprovalPanel = panel;
    this.host.mountEditorReplacement(panel);
  }

  hideApprovalPanel(): void {
    if (this.approvalPreview !== undefined) this.closeApprovalPreview();
    this.activeApprovalPanel = undefined;
    this.host.patchLivePane({ pendingApproval: null });
    this.host.restoreEditor();
  }

  showQuestionDialog(payload: QuestionPanelData): void {
    if (
      this.host.state.activeDialog === 'command' ||
      this.host.state.activeDialog === 'center-modal' ||
      this.host.state.centerModalStack.length > 0
    ) {
      this.host.deferredQuestion = payload;
      return;
    }
    this.host.patchLivePane({ pendingQuestion: { data: payload } });
    notifyUserAttentionOnce(this.host.state, `question:${payload.id}`, {
      title: 'SuperLiora needs your answer',
      body: payload.questions[0]?.question,
    });
    const dialog = new QuestionDialogComponent(
      { data: payload },
      (response) => {
        this.host.questionController.respond(response);
      },
      6,
      () => {
        this.host.toggleToolOutputExpansion();
      },
    );
    this.host.mountEditorReplacement(dialog);
  }

  hideQuestionDialog(): void {
    this.host.patchLivePane({ pendingQuestion: null });
    this.host.restoreEditor();
  }

  private openApprovalPreview(panel: ApprovalPanelComponent, block: ApprovalPreviewBlock): void {
    if (this.approvalPreview !== undefined) return;
    const savedChildren = [...this.host.state.ui.children];
    const viewer = new ApprovalPreviewViewer(
      {
        block,
        onClose: () => {
          this.closeApprovalPreview();
        },
      },
      this.host.state.terminal,
    );
    this.host.state.ui.clear();
    this.host.state.ui.addChild(viewer);
    this.host.state.ui.setFocus(viewer);
    requestTUILayoutRender(this.host.state);
    this.approvalPreview = { component: viewer, savedChildren, panel };
  }

  private closeApprovalPreview(): void {
    const preview = this.approvalPreview;
    if (preview === undefined) return;
    this.approvalPreview = undefined;
    this.host.state.ui.clear();
    for (const child of preview.savedChildren) {
      this.host.state.ui.addChild(child);
    }
    this.host.state.ui.setFocus(preview.panel);
    requestTUILayoutRender(this.host.state);
  }
}
