/**
 * Push Preview Stage — approve/reject remote publish for a done/blocked Conductor job.
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
import { shortJobId } from '#/tui/components/job-board/job-board-helpers';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';

export interface PushPreviewPanelOptions {
  readonly job: ConductorJobCard;
  readonly remote?: string;
  readonly localRef?: string;
  readonly remoteRef?: string;
  readonly onApprove: (summary: string) => void;
  readonly onReject: (summary: string) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

export class PushPreviewPanelComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PushPreviewPanelOptions;
  private selected: 0 | 1 = 0;
  private summaryDraft = '';

  constructor(opts: PushPreviewPanelOptions) {
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
    const remote = this.opts.remote?.trim() || 'origin';
    const localRef = this.opts.localRef?.trim() || 'HEAD';
    const remoteRef = this.opts.remoteRef?.trim() || localRef;
    const body: string[] = [];
    body.push(theme.fg('textStrong', job.title));
    body.push(theme.fg('textMuted', `${shortJobId(job.id)} · ${job.kind} · ${job.status}`));
    body.push('');
    body.push(theme.fg('textMuted', 'Remote publish'));
    body.push(
      truncateToWidth(
        `  ${theme.fg('text', `${localRef} → ${remote}/${remoteRef}`)}`,
        Math.max(1, width),
        '…',
      ),
    );
    if (job.worktreePath !== undefined && job.worktreePath.length > 0) {
      body.push(
        truncateToWidth(
          `  ${theme.fg('textDim', job.worktreePath)}`,
          Math.max(1, width),
          '…',
        ),
      );
    }
    body.push('');
    body.push(theme.fg('textMuted', 'Result summary'));
    const summary =
      job.resultSummary?.trim().length
        ? job.resultSummary.trim()
        : '(no result summary yet)';
    for (const line of wrapTextWithAnsi(summary, Math.max(1, width - 2)).slice(0, 8)) {
      body.push(theme.fg('text', `  ${line}`));
    }
    body.push('');
    body.push(
      theme.fg(
        'textDim',
        'Push ≠ land — approve runs git push on the offload lane (no force-push). Workers cannot push.',
      ),
    );
    body.push('');
    body.push(
      truncateToWidth(
        `${theme.fg('textMuted', 'Summary for push:')} ${theme.fg('text', this.summaryDraft)}█`,
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
      title: ' Push Preview',
      hint: ' ←→ · Y approve · N reject · Esc',
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'push-preview:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
      ellipsis: '…',
    });
  }
}
