export type UpgradeInstallStage =
  | 'checking'
  | 'bootstrapping'
  | 'fetching'
  | 'downloading'
  | 'building'
  | 'installing'
  | 'sidecars'
  | 'done'
  | 'failed';

const UPGRADE_INSTALL_STAGES = new Set<UpgradeInstallStage>([
  'checking',
  'bootstrapping',
  'fetching',
  'downloading',
  'building',
  'installing',
  'sidecars',
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

const GIT_ADVICE_LINE = /retry with 'git restore|inspect what was checked out|Clone succeeded, but checkout failed/i;
const GIT_WRAPPER_LINE = /^error: git (?:clone|fetch|checkout|reset)\b/i;
const UNUSABLE_CHECKOUT = /cannot open ['"]?\.git\/FETCH_HEAD|not a git repository|bad object|missing (?:blob|tree|commit)|corrupt|unable to checkout working tree|invalid path|Filename too long|source checkout is missing git objects/i;

function gitFailureScore(line: string): number {
  if (/invalid path|Filename too long|FETCH_HEAD|no space left|ENOSPC|unable to create file|fsync/i.test(line)) {
    return 3;
  }
  if (/^fatal:/i.test(line)) return 2;
  if (/^error:/i.test(line)) return 1;
  return 0;
}

function isGitAdviceOrWrapper(line: string): boolean {
  return GIT_ADVICE_LINE.test(line) || GIT_WRAPPER_LINE.test(line);
}

/** Pick the actionable git/install line; drop checkout-advice tails. */
export function summarizeGitFailure(output: string, maxLength = 200): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';
  const ranked = lines
    .filter((line) => !isGitAdviceOrWrapper(line))
    .map((line) => ({ line, score: gitFailureScore(line) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const chosen = ranked[0]?.line
    ?? lines.find((line) => !isGitAdviceOrWrapper(line))
    ?? lines[lines.length - 1]
    ?? '';
  if (chosen.length <= maxLength) return chosen;
  return `${chosen.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** True when the checkout cannot be fetched/updated and should be replaced. */
export function isUnusableCheckoutError(message: string): boolean {
  return UNUSABLE_CHECKOUT.test(message);
}
