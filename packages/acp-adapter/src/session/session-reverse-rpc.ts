import type {
  AgentSideConnection,
} from '@agentclientprotocol/sdk';
import {
  log,
  type ApprovalRequest,
  type ApprovalResponse,
  type QuestionAnswers,
  type QuestionRequest,
} from '@superliora/sdk';

import {
  approvalRequestToPermissionOptions,
  attachSelectedLabel,
  buildPermissionToolCallUpdate,
  permissionResponseToApprovalResponse,
} from '#/approval';
import { acpToolCallId } from '#/convert/events-map';
import { outcomeToQuestionAnswer, questionItemToPermissionOptions } from '#/question';
import type { TelemetryTrackFn } from './session';

export interface SessionReverseRpcContext {
  readonly sessionId: string;
  readonly conn: AgentSideConnection;
  getCurrentTurnId(): number | undefined;
  emitTelemetry(event: string, properties?: Record<string, unknown>): void;
}

export async function handleSessionApproval(
  ctx: SessionReverseRpcContext,
  req: ApprovalRequest,
): Promise<ApprovalResponse> {
  const toolCall = buildPermissionToolCallUpdate(ctx.getCurrentTurnId(), req);
  const options = approvalRequestToPermissionOptions(req);
  if (req.display.kind === 'plan_review') {
    const count = req.display.options?.length ?? 0;
    ctx.emitTelemetry('plan_review_options_count', { count });
  }
  try {
    const response = await ctx.conn.requestPermission({
      sessionId: ctx.sessionId,
      options: [...options],
      toolCall,
    });
    return attachSelectedLabel(
      response,
      permissionResponseToApprovalResponse(req, response),
      options,
    );
  } catch (err) {
    log.warn('acp: requestPermission failed; rejecting', {
      sessionId: ctx.sessionId,
      toolCallId: req.toolCallId,
      toolName: req.toolName,
      error: err instanceof Error ? err.message : String(err),
    });
    return { decision: 'rejected' };
  }
}

export async function handleSessionQuestion(
  ctx: SessionReverseRpcContext,
  req: QuestionRequest,
): Promise<QuestionAnswers | null> {
  const questions = req.questions;
  if (questions.length === 0) {
    log.warn('acp: handleQuestion received empty questions array', {
      sessionId: ctx.sessionId,
    });
    return null;
  }
  if (questions.length > 1) {
    log.warn('acp: handleQuestion degrading to first question only', {
      sessionId: ctx.sessionId,
      dropped: questions.length - 1,
    });
    ctx.emitTelemetry('question_degraded', {
      reason: 'multi_question',
      dropped: questions.length - 1,
    });
  }
  const q = questions[0]!;
  if (q.multiSelect === true) {
    ctx.emitTelemetry('question_degraded', { reason: 'multi_select' });
  }
  const options = questionItemToPermissionOptions(q, 0);
  const rawToolCallId = req.toolCallId ?? 'ask-user';
  const currentTurnId = ctx.getCurrentTurnId();
  const toolCallId =
    currentTurnId !== undefined ? acpToolCallId(currentTurnId, rawToolCallId) : rawToolCallId;
  try {
    const response = await ctx.conn.requestPermission({
      sessionId: ctx.sessionId,
      options: [...options],
      toolCall: {
        toolCallId,
        title: 'AskUserQuestion',
        content: [{ type: 'content', content: { type: 'text', text: q.question } }],
      },
    });
    const answer = outcomeToQuestionAnswer(q, response);
    if (answer === null) {
      ctx.emitTelemetry('question_dismissed');
    } else {
      ctx.emitTelemetry('question_answered', { answered: Object.keys(answer).length });
    }
    return answer;
  } catch (err) {
    log.warn('acp: requestPermission (question) failed; dismissing', {
      sessionId: ctx.sessionId,
      toolCallId: req.toolCallId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function emitSessionTelemetry(
  sessionId: string,
  track: TelemetryTrackFn | undefined,
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (typeof track !== 'function') return;
  try {
    track(event, properties);
  } catch (err) {
    log.warn('acp: telemetry track failed', {
      sessionId,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
