/**
 * Mission Control visibility for the in-stage bottom band. The panel mounts
 * in the chrome stack (above the editor) at the stage's full reading width —
 * there is no separate right-side dock.
 */

export type MissionControlMode = 'auto' | 'pinned' | 'hidden';

export interface MissionBandStateLike {
  readonly appState: {
    readonly appearance?: { readonly missionControl?: MissionControlMode };
  };
  readonly missionControlPanel: { isEmpty(): boolean };
}

export function missionControlModeOf(state: MissionBandStateLike): MissionControlMode {
  return state.appState.appearance?.missionControl ?? 'auto';
}

/**
 * Whether the in-stage Mission Control band should paint. Hidden mode is
 * always off; otherwise `pinned` or a non-empty roster mounts the band.
 */
export function missionBandActive(state: MissionBandStateLike): boolean {
  const mode = missionControlModeOf(state);
  if (mode === 'hidden') return false;
  return mode === 'pinned' || !state.missionControlPanel.isEmpty();
}

/**
 * Whether bare Enter should open a Worker Dock transcript instead of
 * submitting the editor. Draft text always wins (`/exit`, prompts); Enter
 * only opens when the dock already has an explicit selection.
 */
export function shouldMissionDockConsumeEnter(input: {
  readonly editorText: string;
  readonly selectedWorkerId: string | undefined;
}): boolean {
  if (input.editorText.trim().length > 0) return false;
  return input.selectedWorkerId !== undefined;
}

/**
 * Whether bare ↑/↓ should navigate the Worker Dock instead of the editor.
 *
 * Product rule: the editor owns ↑ when it is focused (empty prompt, first-line
 * caret, or a queued/history recall). The dock only consumes ↑/↓ after an
 * explicit row selection — same gate as Enter. A visible-but-unfocused dock
 * must not steal prompt-history recall.
 */
export function shouldMissionDockConsumeArrow(input: {
  readonly selectedWorkerId: string | undefined;
}): boolean {
  return input.selectedWorkerId !== undefined;
}
