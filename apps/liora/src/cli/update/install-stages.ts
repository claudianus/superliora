export type UpgradeInstallStage =
  | 'checking'
  | 'fetching'
  | 'downloading'
  | 'building'
  | 'installing'
  | 'done'
  | 'failed';

const UPGRADE_INSTALL_STAGES = new Set<UpgradeInstallStage>([
  'checking',
  'fetching',
  'downloading',
  'building',
  'installing',
  'done',
  'failed',
]);

const STAGE_MARKER_PREFIX = '__LIORA_UPGRADE_STAGE__=';

function isUpgradeInstallStage(value: string): value is UpgradeInstallStage {
  return UPGRADE_INSTALL_STAGES.has(value as UpgradeInstallStage);
}

/** Parse a single stdout/stderr line for `__LIORA_UPGRADE_STAGE__=<stage>`. */
export function parseUpgradeStageLine(line: string): UpgradeInstallStage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(STAGE_MARKER_PREFIX)) return null;
  const stage = trimmed.slice(STAGE_MARKER_PREFIX.length);
  return isUpgradeInstallStage(stage) ? stage : null;
}
