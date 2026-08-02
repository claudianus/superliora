import type { Component, Focusable } from '#/tui/renderer';
import type { CenterModalMountMode, CenterModalMountOptions } from '#/tui/utils/ui/center-modal';

/** Minimal host surface for center-modal vs editor-replacement pickers. */
export interface PickerMountHost {
  mountCenterModal(
    panel: Component & Focusable,
    options?: CenterModalMountOptions,
  ): void;
  closeCenterModal(): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  state: { readonly centerModalStack?: readonly unknown[] };
}

/** Prefer center modal for beginner menus; falls back to editor replacement. */
export function mountPickerDialog(
  host: PickerMountHost,
  panel: Component & Focusable,
  options: CenterModalMountOptions = {},
): void {
  // Nested under an open Hub (or any center modal): push so Esc returns.
  // Tests/hosts may omit centerModalStack — treat as empty.
  const stackLen = host.state.centerModalStack?.length ?? 0;
  const mode: CenterModalMountMode =
    options.mode ?? (stackLen > 0 ? 'push' : 'replace');
  host.mountCenterModal(panel, { mode, label: options.label });
}

export function dismissPickerDialog(host: PickerMountHost): void {
  const stackLen = host.state.centerModalStack?.length ?? 0;
  if (stackLen > 0) {
    host.closeCenterModal();
    return;
  }
  host.restoreEditor();
}
