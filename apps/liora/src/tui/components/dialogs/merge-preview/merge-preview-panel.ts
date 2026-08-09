/**
 * Merge Preview Stage — approve/reject land for a done/blocked Conductor job.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  wrapTextWithAnsi,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { formatMissingGateEvidence } from '#/tui/utils/job/gate-preview';
import { formatTrustReasonForUser } from '#/tui/utils/job/trust-copy';
import { shortJobId } from '#/tui/components/job-board/job-board-helpers';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';
import type { JobGateChecklist } from '@superliora/protocol';

export interface MergePreviewPanelOptions {
  readonly job: ConductorJobCard;
  /** Raw trust / merge hold reason when known (notes / last error). */
  readonly trustReason?: string;
  readonly onApprove: (summary: string) => void;
  readonly onReject: (summary: string) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

export class MergePreviewPanelComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: MergePreviewPanelOptions;
  private selected: 0 | 1 = 0;
  private summaryDraft = '';

  constructor(opts: MergePreviewPanelOptions) {
    super();
    this.opts = opts;
    this.summaryDraft = (opts.job.resultSummary ?? '').slice(0, 240);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
      this.selected = 0;
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) {
      this.selected = 1;
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      if (this.selected === 0) {
        this.opts.onApprove(this.summaryDraft.trim());
      } else {
        this.opts.onReject(this.summaryDraft.trim());
      }
      return;
    }
    const ch = printableChar(data);
    if (ch === 'y' || ch === 'Y' || ch === 'a' || ch === 'A') {
      this.opts.onApprove(this.summaryDraft.trim());
      return;
    }
    if (ch === 'n' || ch === 'N' || ch === 'r' || ch === 'R') {
      this.opts.onReject(this.summaryDraft.trim());
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      this.summaryDraft = this.summaryDraft.slice(0, -1);
      this.opts.requestRender?.();
      return;
    }
    if (ch !== undefined && ch.length === 1 && ch !== '\n') {
      if (this.summaryDraft.length < 400) {
        this.summaryDraft += ch;
        this.opts.requestRender?.();
      }
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const job = this.opts.job;
    const body: string[] = [];
    body.push(theme.fg('textStrong', job.title));
    body.push(theme.fg('textMuted', `${shortJobId(job.id)} · ${job.kind} · ${job.status}`));
    body.push('');
    body.push(theme.fg('textMuted', 'Gates'));
    body.push(...renderGateLines(job.gateChecklist, width));
    const missing = formatMissingGateEvidence(job.gateChecklist);
    if (missing.length > 0) {
      body.push(theme.fg('warning', 'Missing evidence'));
      for (const line of missing) {
        body.push(theme.fg('textDim', `  · ${line}`));
      }
    }
    body.push('');
    if (this.opts.trustReason !== undefined && this.opts.trustReason.trim().length > 0) {
      const trust = formatTrustReasonForUser(this.opts.trustReason);
      body.push(theme.fg('warning', trust.headline));
      if (trust.fix !== undefined) {
        for (const line of wrapTextWithAnsi(trust.fix, Math.max(1, width - 2))) {
          body.push(theme.fg('textDim', `  ${line}`));
        }
      }
      body.push('');
    }
    body.push(theme.fg('textMuted', 'Result summary'));
    const summary =
      job.resultSummary?.trim().length
        ? job.resultSummary.trim()
        : '(no result summary yet)';
    for (const line of wrapTextWithAnsi(summary, Math.max(1, width - 2)).slice(0, 8)) {
      body.push(theme.fg('text', `  ${line}`));
    }
    body.push('');
    body.push(theme.fg('textDim', 'Land ≠ push — approve lands the worktree merge; remote push stays separate.'));
    body.push('');
    body.push(
      truncateToWidth(
        `${theme.fg('textMuted', 'Summary for land:')} ${theme.fg('text', this.summaryDraft)}█`,
        Math.max(1, width),
        '…',
      ),
    );
    body.push('');
    const approve =
      this.selected === 0
        ? theme.boldFg('success', '[ Approve ]')
        : theme.fg('textMuted', '  Approve  ');
    const reject =
      this.selected === 1
        ? theme.boldFg('error', '[ Reject ]')
        : theme.fg('textMuted', '  Reject  ');
    body.push(`  ${approve}   ${reject}`);

    return renderRendererPanelChromeRows({
      width,
      title: ' Merge Preview',
      hint: ' ←→ · Y approve · N reject · Esc',
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'merge-preview:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
      ellipsis: '…',
    });
  }
}

function renderGateLines(
  gates: JobGateChecklist | undefined,
  width: number,
): string[] {
  const theme = currentTheme;
  if (gates === undefined) {
    return [theme.fg('textDim', '  (no gate checklist on this job yet)')];
  }
  const parts = [
    `tests=${gates.tests}`,
    `typecheck=${gates.typecheck}`,
    `review=${gates.review}`,
    `visual=${gates.visual}`,
  ];
  return [
    truncateToWidth(`  ${theme.fg('text', parts.join('  ·  '))}`, Math.max(1, width), '…'),
  ];
}
