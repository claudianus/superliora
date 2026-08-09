/**
 * User-facing product name for the in-stage worker monitor band.
 * Gate: conductor_ux_v2 → "Worker Dock"; legacy → "Mission Control".
 */

import { isExperimentalFlagEnabled } from '#/tui/commands/experimental-flags';
import { ttui } from '#/tui/utils/tui-i18n';

export function missionBandProductName(): string {
  return isExperimentalFlagEnabled('conductor_ux_v2')
    ? ttui('tui.missionControl.workerDock')
    : ttui('tui.missionControl.missionControl');
}
