/**
 * User-facing product name for the in-stage worker monitor band.
 * Gate: conductor_ux_v2 → "Worker Dock"; legacy → "Mission Control".
 */

import { isExperimentalFlagEnabled } from '#/tui/commands/experimental-flags';

export function missionBandProductName(): string {
  return isExperimentalFlagEnabled('conductor_ux_v2') ? 'Worker Dock' : 'Mission Control';
}
