/**
 * Reverse RPC view-layer types.
 *
 * These types are the contract between the UI layer and reverse RPC
 * controllers, not SDK event payloads. Approval and question adapters convert
 * core payloads into these shapes for panel components.
 */

import type { QuestionAnswerMethod } from '@superliora/sdk';

// ── Display blocks (approval panel) ──────────────────────────────────

export interface BriefDisplayBlock {
  type: 'brief';
  text: string;
}


export interface ShellDisplayBlock {
  type: 'shell';
  language: string;
  command: string;
  cwd?: string | undefined;
  description?: string | undefined;
  danger?: string | undefined;
}

export type DisplayBlock = BriefDisplayBlock | ShellDisplayBlock;

export interface ApprovalPanelChoice {
  label: string;
  response: 'approved' | 'approved_for_session' | 'rejected' | 'cancelled';
  selected_label?: string | undefined;
  requires_feedback?: boolean | undefined;
  // Optional helper text shown dim beneath the label. Omitted/empty renders
  // exactly as a plain label-only choice.
  description?: string | undefined;
}

// ── Approval / Question view payloads ────────────────────────────────


export interface ApprovalPanelData {
  id: string;
  tool_call_id: string;
  tool_name: string;
  action: string;
  description: string;
  display: DisplayBlock[];
  choices: ApprovalPanelChoice[];
}

export interface QuestionPanelItem {
  question: string;
  header?: string;
  body?: string;
  multi_select: boolean;
  other_label?: string;
  other_description?: string;
  options: Array<{ label: string; description?: string }>;
}

export interface QuestionPanelData {
  id: string;
  tool_call_id: string;
  questions: QuestionPanelItem[];
}

export type QuestionSubmissionMethod = QuestionAnswerMethod;

export interface QuestionPanelResponse {
  readonly answers: string[];
  readonly method?: QuestionSubmissionMethod | undefined;
}

// ── Pending state wrappers ───────────────────────────────────────────

export interface PendingApproval {
  data: ApprovalPanelData;
}

export interface PendingQuestion {
  data: QuestionPanelData;
}
