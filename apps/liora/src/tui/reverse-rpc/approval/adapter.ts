import type { ApprovalRequest, ApprovalResponse } from '@superliora/sdk';

import type { ApprovalPanelResponse } from '#/tui/components/dialogs/approval/approval-panel';
import type { ApprovalPanelChoice, ApprovalPanelData, DisplayBlock } from '#/tui/reverse-rpc/types';
import { ttui } from '#/tui/utils/tui-i18n';

function defaultApprovalChoices(): ApprovalPanelChoice[] {
  return [
    { label: ttui('tui.approval.approveOnce'), response: 'approved' },
    { label: ttui('tui.approval.approveSession'), response: 'approved_for_session' },
    { label: ttui('tui.approval.reject'), response: 'rejected' },
    { label: ttui('tui.approval.rejectFeedback'), response: 'rejected', requires_feedback: true },
  ];
}

export function adaptApprovalRequest(event: ApprovalRequest): ApprovalPanelData {
  const display = event.display;
  const detail = display.kind === 'generic' && typeof display.detail === 'object' && display.detail !== null
    ? display.detail as Record<string, unknown>
    : undefined;
  const command = display.kind === 'command'
    ? display.command
    : typeof detail?.['command'] === 'string' ? detail['command'] : undefined;
  const description = display.kind === 'command'
    ? display.description ?? event.action
    : display.kind === 'generic' ? display.summary ?? event.action : event.action;
  const blocks: DisplayBlock[] = command === undefined ? [{ type: 'brief', text: description }] : [{
    type: 'shell',
    command,
    language: display.kind === 'command' ? display.language ?? 'bash' : 'bash',
    cwd: display.kind === 'command' ? display.cwd : typeof detail?.['cwd'] === 'string' ? detail['cwd'] : undefined,
    description,
    danger: detectDanger(command),
  }];
  return {
    id: event.toolCallId,
    tool_call_id: event.toolCallId,
    tool_name: event.toolName,
    action: event.action,
    description,
    display: blocks,
    choices: defaultApprovalChoices(),
  };
}

export function adaptPanelResponse(response: ApprovalPanelResponse): ApprovalResponse {
  if (response.response === 'approved_for_session') {
    return { decision: 'approved', scope: 'session', feedback: response.feedback };
  }
  return {
    decision: response.response === 'approved' ? 'approved' : response.response === 'rejected' ? 'rejected' : 'cancelled',
    feedback: response.feedback,
  };
}

const DANGER_PATTERNS: Array<{ pattern: RegExp; labelKey: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rRfF][a-zA-Z]*|--recursive|--force)/i, labelKey: 'tui.approval.danger.recursiveDelete' },
  { pattern: /\bsudo\b/i, labelKey: 'tui.approval.danger.sudo' },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/i, labelKey: 'tui.approval.danger.pipeShell' },
  { pattern: /\bdd\b[^|]*\bof=/i, labelKey: 'tui.approval.danger.ddWrite' },
  { pattern: /\bmkfs\b/i, labelKey: 'tui.approval.danger.mkfs' },
  { pattern: />\s*\/dev\/(sd|nvme|disk|hd)/i, labelKey: 'tui.approval.danger.rawDevice' },
  { pattern: /\bchmod\s+-R?\s*777\b/i, labelKey: 'tui.approval.danger.chmod777' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}/i, labelKey: 'tui.approval.danger.forkBomb' },
];

function detectDanger(command: string): string | undefined {
  for (const { pattern, labelKey } of DANGER_PATTERNS) {
    if (pattern.test(command)) return ttui(labelKey);
  }
  return undefined;
}
