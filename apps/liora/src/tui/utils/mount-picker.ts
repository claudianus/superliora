import type { Component, Focusable } from '#/tui/renderer';
import type { CenterModalMountMode, CenterModalMountOptions } from '#/tui/utils/center-modal';

/** Minimal host surface for center-modal vs editor-replacement pickers. */
export interface PickerMountHost {
  mountCenterModal(
    panel: Component & Focusable,
    options?: CenterModalMountOptions,
  ): void;
  closeCenterModal(): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  state: { readonly centerModalStack: readonly unknown[] };
}

/** Prefer center modal for beginner menus; falls back to editor replacement. */
export function mountPickerDialog(
  host: PickerMountHost,
  panel: Component & Focusable,
  options: CenterModalMountOptions = {},
): void {
  // Nested under an open Hub (or any center modal): push so Esc returns.
  const mode: CenterModalMountMode =
    options.mode ?? (host.state.centerModalStack.length > 0 ? 'push' : 'replace');
  host.mountCenterModal(panel, { mode, label: options.label });
}

export function dismissPickerDialog(host: PickerMountHost): void {
  if (host.state.centerModalStack.length > 0) {
    host.closeCenterModal();
    return;
  }
  host.restoreEditor();
}
