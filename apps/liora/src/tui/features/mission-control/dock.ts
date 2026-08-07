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
