/**
 * Host helper: show SplitConfirmSheet when intents ≥ 3 (F09).
 * Used by `/job split-preview` and jobCreateBatch wrappers.
 */

import type { Component, Focusable } from '#/tui/renderer';

import {
  resolveSplitConfirmChoice,
  SplitConfirmSheetComponent,
  type JobSplitIntent,
} from '../../components/dialogs/job/split-confirm-sheet';

export interface ConfirmJobSplitHost {
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  requestRender?(): void;
}

/**
 * When `intents.length >= 3`, mount the confirm sheet.
 * Shorter lists pass through unchanged. Cancel → null.
 */
export function confirmJobSplit(
  host: ConfirmJobSplitHost,
  intents: readonly JobSplitIntent[],
): Promise<readonly JobSplitIntent[] | null> {
  if (intents.length < 3) {
    return Promise.resolve(intents);
  }
  return new Promise((resolve) => {
    const finish = (result: readonly JobSplitIntent[] | null): void => {
      host.restoreEditor();
      resolve(result);
    };
    host.mountEditorReplacement(
      new SplitConfirmSheetComponent({
        intents,
        onSelect: (choice) => {
          finish(resolveSplitConfirmChoice(intents, choice));
        },
        onCancel: () => {
          finish(null);
        },
        requestRender: () => {
          host.requestRender?.();
        },
      }),
    );
  });
}
