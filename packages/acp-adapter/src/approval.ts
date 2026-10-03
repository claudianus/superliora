import type {
  PermissionOption,
  RequestPermissionResponse,
  ToolCallContent,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type { ApprovalRequest, ApprovalResponse } from '@superliora/sdk';

import { displayBlockToAcpContent } from '#/convert/index';
import { acpToolCallId } from '#/convert/events-map';

/**
 * Canonical option ids surfaced to the ACP client.
 *
 * The wire-level `PermissionOption.optionId` is opaque to the client (it
 * round-trips back in `RequestPermissionResponse.outcome.optionId`), so
 * the adapter is free to pick any stable string. These literals are the
 * single source of truth on both the build- and the parse-side; tests
 * import them rather than re-typing the strings.
 */
export const APPROVE_ONCE_OPTION_ID = 'approve_once';
export const APPROVE_ALWAYS_OPTION_ID = 'approve_always';
export const REJECT_OPTION_ID = 'reject';

/**
 * The three canonical permission options surfaced to the ACP client.
 *
 * Order is load-bearing: ACP clients (Zed at the time of writing) render
 * the options top-to-bottom, so allow-once is the primary action,
 * allow-always is the secondary, and reject is the terminal/dangerous
 * action that should be hardest to click by accident.
 *
 * The `kind` field controls client styling; `name` is the UI label.
 * Native approval responses carry only consent, scope, and feedback.
 */
const CANONICAL_OPTIONS: readonly PermissionOption[] = [
  { optionId: APPROVE_ONCE_OPTION_ID, name: 'Approve once', kind: 'allow_once' },
  {
    optionId: APPROVE_ALWAYS_OPTION_ID,
    name: 'Approve for this session',
    kind: 'allow_always',
  },
  { optionId: REJECT_OPTION_ID, name: 'Reject', kind: 'reject_once' },
];

/** Native approvals have exactly the canonical consent options. */
export function approvalRequestToPermissionOptions(): readonly PermissionOption[] {
  return CANONICAL_OPTIONS;
}

/** Translate native consent, rejecting unknown option ids. */
export function permissionResponseToApprovalResponse(
  response: RequestPermissionResponse,
): ApprovalResponse {
  if (response.outcome.outcome === 'cancelled') {
    return { decision: 'cancelled' };
  }
  const optionId = response.outcome.optionId;
  switch (optionId) {
    case APPROVE_ONCE_OPTION_ID:
      return { decision: 'approved' };
    case APPROVE_ALWAYS_OPTION_ID:
      return { decision: 'approved', scope: 'session' };
    case REJECT_OPTION_ID:
      return { decision: 'rejected' };
    default:
      // Unknown optionId — defensive fallback. Reject is safer than
      // approve. Logging is the caller's responsibility (the mapper is
      // pure so unit tests don't need to mock a logger).
      return { decision: 'rejected' };
  }
}

/**
 * Build the ACP {@link ToolCallUpdate} that scopes a permission request
 * to a specific in-flight tool call.
 *
 * The `toolCallId` is the **prefixed** ACP wire id `${turnId}:${rawId}`
 * — matching the id format used by all other tool_call/tool_call_update
 * notifications — so the client can correlate the approval prompt with
 * the tool card it already rendered. If `turnId` is `undefined` (the
 * `onEvent` listener has not yet observed any turn-scoped event), the
 * raw SDK id is used as a defensive fallback. In practice approvals
 * always fire **after** `tool.call.started`, so the fallback is
 * effectively unreachable; it exists so the handler never throws.
 *
 * Content contains the native command or operation summary followed by
 * the approval action, so clients can show what is being authorized.
 */
export function buildPermissionToolCallUpdate(
  turnId: number | undefined,
  req: ApprovalRequest,
): ToolCallUpdate {
  const toolCallId =
    turnId !== undefined ? acpToolCallId(turnId, req.toolCallId) : req.toolCallId;
  const content: ToolCallContent[] = [];
  content.push(displayBlockToAcpContent(req.display));
  // Always include the action summary so the prompt is never empty.
  content.push({
    type: 'content',
    content: { type: 'text', text: `Requesting approval to ${req.action}` },
  });
  return {
    toolCallId,
    title: req.toolName,
    content,
  };
}

