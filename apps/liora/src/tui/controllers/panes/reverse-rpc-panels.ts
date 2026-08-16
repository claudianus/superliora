import type { Component, Focusable } from '#/tui/renderer';

import {
  ApprovalPanelComponent,
  type ApprovalPanelResponse,
} from '../../components/dialogs/approval/approval-panel';
import {
  ApprovalPreviewViewer,
  type ApprovalPreviewBlock,
} from '../../components/dialogs/approval/approval-preview';
import { QuestionDialogComponent } from '../../components/dialogs/question/question-dialog';
import { adaptPanelResponse } from '../../reverse-rpc/approval/adapter';
import type { ApprovalController } from '../../reverse-rpc/approval/controller';
import type { QuestionController } from '../../reverse-rpc/question/controller';
import type { ApprovalPanelData, QuestionPanelData } from '../../reverse-rpc/types';
import type { TUIState } from '../../tui-state';
import type { AppState, LivePaneState, PlanTranscriptData } from '../../types';
import { shouldPermissionApproveFlourish } from '../../utils/never-halt/permission-approve-flourish';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { notifyUserAttentionOnce } from '../../utils/terminal/terminal-notification';

/** Host surface for SDK approval and question panel mounting. */
export interface ReverseRpcPanelsHost {
  state: TUIState;
  deferredApproval: ApprovalPanelData | undefined;
  deferredQuestion: QuestionPanelData | undefined;
  readonly approvalController: ApprovalController;
  readonly questionController: QuestionController;
  readonly reverseRpcDisposers: Array<() => void>;

  patchLivePane(patch: Partial<LivePaneState>): void;
  setAppState(patch: Partial<AppState>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  toggleToolOutputExpansion(): void;
  appendPlanReviewTranscript(toolCallId: string, plan: PlanTranscriptData): boolean;
}

/**
 * Approval and question dialog mounting, deferral, and preview viewer.
 * LioraTUI keeps thin public delegates so reverse-rpc wiring stays stable.
 */
export class ReverseRpcPanelsController {
  private activeApprovalPanel: ApprovalPanelComponent | undefined;
  /** True while a question dialog owns the editor replacement (or is deferred). */
  private questionPanelActive = false;
  private approvalPreview:
    | {
        component: ApprovalPreviewViewer;
        savedChildren: ReverseRpcPanelsHost['state']['ui']['children'][number][];
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
    // Drop deferred mounts before cancel so restoreEditor cannot re-open a
    // cancelled question/approval that no longer has a waiter (input trap).
    this.host.deferredApproval = undefined;
    this.host.deferredQuestion = undefined;
    this.host.approvalController.cancelAll(reason);
    this.host.questionController.cancelAll(reason);
    // cancelAll hides via UI hooks when wired; still force teardown so a stale
    // editor replacement cannot keep the native input sink after abort/restart.
    this.hideApprovalPanel();
    this.hideQuestionDialog();
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
    if (payload.planReview !== undefined) {
      this.host.appendPlanReviewTranscript(payload.tool_call_id, {
        content: payload.planReview.content,
        path: payload.planReview.path,
        toolCallId: payload.tool_call_id,
      });
    }
    this.host.patchLivePane({ pendingApproval: { data: payload } });
    notifyUserAttentionOnce(this.host.state, `approval:${payload.id}`, {
      title: 'SuperLiora approval required',
      body: payload.tool_name,
    });
    const panel = new ApprovalPanelComponent(
      { data: payload },
      (response: ApprovalPanelResponse) => {
        if (shouldPermissionApproveFlourish(response)) {
          this.host.setAppState({ permissionApproveFlourish: { atMs: Date.now() } });
        }
        this.host.approvalController.respond(
          adaptPanelResponse(response, {
            plan: payload.planReview?.content,
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

  /** Re-mount the live approval panel when Ops or other surfaces request focus. */
  focusPendingApprovalPanel(): boolean {
    const pending = this.host.state.livePane.pendingApproval;
    if (pending !== null) {
      this.showApprovalPanel(pending.data);
      return true;
    }
    const deferred = this.host.deferredApproval;
    if (deferred !== undefined) {
      this.showApprovalPanel(deferred);
      return true;
    }
    return false;
  }

  showQuestionDialog(payload: QuestionPanelData): void {
    if (
      this.host.state.activeDialog === 'command' ||
      this.host.state.activeDialog === 'center-modal' ||
      this.host.state.centerModalStack.length > 0
    ) {
      this.host.deferredQuestion = payload;
      this.questionPanelActive = true;
      return;
    }
    this.questionPanelActive = true;
    this.host.patchLivePane({ pendingQuestion: { data: payload } });
    notifyUserAttentionOnce(this.host.state, `question:${payload.id}`, {
      title: 'SuperLiora needs your answer',
      body: payload.questions[0]?.question,
    });
    const dialog = new QuestionDialogComponent(
      { data: payload },
      (response) => {
        // respond() always hidePanel → hideQuestionDialog; keep this path
        // even when the panel is stale so Escape / Cancel still free input.
        this.host.questionController.respond(response);
      },
      6,
      () => {
        this.host.toggleToolOutputExpansion();
      },
    );
    this.host.mountEditorReplacement(dialog);
  }

  /**
   * Tear down the question editor replacement. Idempotent: safe after abort,
   * session switch, or double-hide. Always clears deferred so restoreEditor
   * cannot remount a dead dialog that swallows keys with no waiter.
   *
   * Always restores the editor even when bookkeeping already looks empty — a
   * dead mountEditorReplacement can still own the native input sink.
   */
  hideQuestionDialog(): void {
    this.questionPanelActive = false;
    this.host.deferredQuestion = undefined;
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
