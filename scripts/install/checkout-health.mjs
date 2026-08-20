/**
 * Managed source-checkout health. Keep in sync with
 * apps/liora/src/cli/update/git-checkout.ts + install-stages.ts.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const GIT_ADVICE_LINE = /retry with 'git restore|inspect what was checked out|Clone succeeded, but checkout failed/i;
const GIT_WRAPPER_LINE = /^error: git (?:clone|fetch|checkout|reset)\b/i;

/**
 * @param {string} repoRoot
 * @returns {boolean}
 */
export function hasUsableGitObjectStore(repoRoot) {
  if (!existsSync(join(repoRoot, '.git'))) return false;
  const head = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8',
  });
  if (head.status !== 0) return false;
  const sha = head.stdout.trim();
  if (!sha) return false;
  const obj = spawnSync('git', ['-C', repoRoot, 'cat-file', '-e', `${sha}^{commit}`], {
    encoding: 'utf8',
  });
  return obj.status === 0;
}

/**
 * @param {string} repoRoot
 * @returns {boolean}
 */
export function isHealthySourceCheckout(repoRoot) {
  return hasUsableGitObjectStore(repoRoot) && existsSync(join(repoRoot, 'package.json'));
}

/**
 * @param {string} output
 * @param {number} [maxLength]
 * @returns {string}
 */
export function summarizeGitFailure(output, maxLength = 200) {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return '';
  let best = '';
  let bestScore = -1;
  for (const line of lines) {
    if (GIT_ADVICE_LINE.test(line) || GIT_WRAPPER_LINE.test(line)) continue;
    let score = 0;
    if (/invalid path|Filename too long|FETCH_HEAD|no space left|ENOSPC|unable to create file|fsync/i.test(line)) {
      score = 3;
    } else if (/^fatal:/i.test(line)) {
      score = 2;
    } else if (/^error:/i.test(line)) {
      score = 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  const chosen = best || lines.find((line) => !GIT_ADVICE_LINE.test(line) && !GIT_WRAPPER_LINE.test(line)) || lines[lines.length - 1] || '';
  if (chosen.length <= maxLength) return chosen;
  return `${chosen.slice(0, Math.max(0, maxLength - 1))}…`;
}
