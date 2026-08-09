/**
 * TUI jobCreateBatch wrapper with optional split confirm (≥3 intents) (F09).
 */

import type { Component, Focusable } from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';

import { confirmJobSplit } from './confirm-job-split';
import type { JobSplitIntent } from '../../components/dialogs/job/split-confirm-sheet';

export interface JobCreateBatchHost {
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  requestRender?(): void;
  showStatus(msg: string, color?: ColorToken): void;
  requireSession(): {
    jobCreateBatch(
      jobs: readonly { readonly title: string; readonly prompt?: string }[],
    ): Promise<{ readonly jobs: readonly unknown[]; readonly text: string }>;
    jobPreviewSplit(text: string): Promise<readonly JobSplitIntent[]>;
  };
}

/**
 * Preview-split `text`, confirm when ≥3 intents, then jobCreateBatch.
 * Returns created count, or null when the user cancelled.
 */
export async function jobCreateBatchWithSplitConfirm(
  host: JobCreateBatchHost,
  text: string,
): Promise<number | null> {
  const intents = await host.requireSession().jobPreviewSplit(text);
  if (intents.length === 0) {
    host.showStatus('No job intents found in that text.', 'textMuted');
    return 0;
  }
  const confirmed = await confirmJobSplit(host, intents);
  if (confirmed === null) {
    host.showStatus('Split cancelled — no jobs created.', 'textMuted');
    return null;
  }
  const result = await host.requireSession().jobCreateBatch(
    confirmed.map((intent) => ({
      title: intent.title,
      prompt: intent.prompt,
    })),
  );
  host.showStatus(
    `Created ${String(result.jobs.length)} Conductor job${result.jobs.length === 1 ? '' : 's'}`,
    'success',
  );
  return result.jobs.length;
}
