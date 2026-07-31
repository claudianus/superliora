/**
 * Settings → Ops Theatre glance lines (SSOT §9.2) — read-only tips + live queue.
 */

import { formatInterventionQueueSettingsLine } from '../never-halt/intervention-glance';

export const OPS_THEATRE_OPEN_TIP = 'Open live theatre: /ops (Goal · git · MCP · approval tray).';

export const OPS_THEATRE_LAYOUT_TIP =
  'Layout: 4-pane Ops grid — Mission/Fleet · git diff · channel health · intervention tray.';

export const OPS_THEATRE_GIT_TIP =
  'Git: /ops shows live working-tree status + hunk snippets when the workspace is a git repo.';

export const OPS_THEATRE_TRAY_TIP =
  'Interrupt tray: Enter focuses the pending approval panel · Esc dismisses the theatre.';

export const OPS_THEATRE_PREMIUM_TIP =
  'Motion / XP / streak sparks: Settings → Visual Quality (PREMIUM Dopamine Ops).';

export const OPS_THEATRE_STEER_TIP = 'Mid-turn steer: Ctrl-S · /ops auto-refreshes while open.';

export function buildOpsTheatreSettingsLines(input: {
  readonly pendingInterventions?: number;
  readonly oldestInterventionAgeMs?: number;
  readonly staleInterventions?: number;
  readonly sessionUnavailable?: boolean;
  readonly permissionMode?: string;
}): string[] {
  const queueLine = formatInterventionQueueSettingsLine({
    pendingInterventions: input.pendingInterventions,
    oldestInterventionAgeMs: input.oldestInterventionAgeMs,
    staleInterventions: input.staleInterventions,
    sessionUnavailable: input.sessionUnavailable,
  });
  const permission =
    input.permissionMode !== undefined && input.permissionMode.length > 0
      ? `Permission mode: ${input.permissionMode}`
      : 'Permission mode: (unknown)';

  return [
    '── Ops Theatre ─────────────────────────────',
    OPS_THEATRE_OPEN_TIP,
    OPS_THEATRE_LAYOUT_TIP,
    '',
    '── Live now ────────────────────────────────',
    queueLine,
    permission,
    '',
    '── Tips ────────────────────────────────────',
    OPS_THEATRE_GIT_TIP,
    OPS_THEATRE_TRAY_TIP,
    OPS_THEATRE_STEER_TIP,
    OPS_THEATRE_PREMIUM_TIP,
    'Related: Settings → Never-Halt · Fleet · Visual Quality · Bench / Diagnostics.',
  ];
}
