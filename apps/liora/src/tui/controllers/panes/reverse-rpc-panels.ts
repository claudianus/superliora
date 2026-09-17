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
import { ttui } from '#/tui/utils/tui-i18n';

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
  /**
   * The question dialog currently mounted as the editor replacement, if any.
   * Checked by identity against the live editor container so a queued question
   * can tell "our own takeover" from a foreign command dialog.
   */
  private mountedQuestionDialog: QuestionDialogComponent | undefined;
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
    if (this.shouldDeferApprovalPanel()) {
      // Deferred does not mean invisible: the agent is parked on this approval,
      // so raise the same attention notification the mounted panel would show.
      notifyUserAttentionOnce(this.host.state, `approval:${payload.id}`, {
        title: ttui('tui.notice.approvalRequired'),
        body: payload.tool_name,
      });
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
      title: ttui('tui.notice.approvalRequired'),
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

  /**
   * Whether an incoming approval must wait for the editor to free up.
   *
   * Same self-marker misread as H11 (questions): `showApprovalPanel` mounts
   * its panel through `mountEditorReplacement`, which marks the takeover
   * `activeDialog = 'command'` (modal-shell.ts:35). Reading that self-inflicted
   * marker as "an unrelated modal is open" deferred every queued approval
   * forever — `advanceOrHide` (base-controller.ts:124-132) only hides once the
   * queue drains, so nothing called `hideApprovalPanel` in between and the
   * already-answered panel stayed on screen swallowing Enter.
   *
   * Ownership is verified by identity against the live editor container, so a
   * real foreign takeover (Help, /login, session picker) and any center modal
   * still defer exactly as before.
   */
  private shouldDeferApprovalPanel(): boolean {
    const state = this.host.state;
    if (state.centerModalStack.length > 0 || state.activeDialog === 'center-modal') return true;
    if (state.activeDialog !== 'command') return false;
    return !this.ownsApprovalEditorReplacement();
  }

  private ownsApprovalEditorReplacement(): boolean {
    const mounted = this.activeApprovalPanel;
    if (mounted === undefined) return false;
    return this.host.state.editorContainer.children.at(-1) === mounted;
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
    if (this.shouldDeferQuestionDialog()) {
      notifyUserAttentionOnce(this.host.state, `question:${payload.id}`, {
        title: ttui('tui.notice.needsAnswer'),
        body: payload.questions[0]?.question,
      });
      this.host.deferredQuestion = payload;
      this.questionPanelActive = true;
      return;
    }
    this.questionPanelActive = true;
    this.host.patchLivePane({ pendingQuestion: { data: payload } });
    notifyUserAttentionOnce(this.host.state, `question:${payload.id}`, {
      title: ttui('tui.notice.needsAnswer'),
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
    this.mountedQuestionDialog = dialog;
    this.host.mountEditorReplacement(dialog);
  }

  /**
   * Whether an incoming question must wait for the editor to free up.
   *
   * Advancing a queued question calls `showQuestionDialog` again, and the
   * previous question was itself mounted through `mountEditorReplacement` —
   * which marks the takeover `activeDialog = 'command'` (modal-shell.ts:35).
   * Reading that self-inflicted marker as "an unrelated modal is open" deferred
   * every follow-up question forever: the controller only hides the panel once
   * its queue drains (`advanceOrHide`, base-controller.ts:124-132), so nothing
   * called `hideQuestionDialog` in between. The already-answered dialog stayed
   * on screen and swallowed Enter — the H11 freeze.
   *
   * Ownership is verified by identity against the live editor container, so a
   * real foreign takeover (Help, /login, session picker) and any center modal
   * still defer exactly as before.
   */
  private shouldDeferQuestionDialog(): boolean {
    const state = this.host.state;
    if (state.centerModalStack.length > 0 || state.activeDialog === 'center-modal') return true;
    if (state.activeDialog !== 'command') return false;
    return !this.ownsEditorReplacement();
  }

  private ownsEditorReplacement(): boolean {
    const mounted = this.mountedQuestionDialog;
    if (mounted === undefined) return false;
    return this.host.state.editorContainer.children.at(-1) === mounted;
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
    this.mountedQuestionDialog = undefined;
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
