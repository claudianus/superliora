/**
 * Compact repo-index footer pill — engine gate + codemap warmth (Settings → Index SSOT).
 */
import { getCodemapStatus, getRepoIndexStatus } from '@superliora/sdk';

import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';

export function formatIndexFooterBadge(
  workDir: string,
  env: NodeJS.ProcessEnv = process.env,
): FooterBadge | null {
  const dir = workDir.trim();
  if (dir.length === 0) return null;

  const repoIndex = getRepoIndexStatus(env);
  if (repoIndex.engine === 'stub') {
    return { text: 'idx·stub-off', severity: 'muted' };
  }

  const codemap = getCodemapStatus(dir);
  switch (codemap.warmth) {
    case 'warm':
      return { text: 'idx·warm', severity: 'info' };
    case 'cold':
      return { text: 'idx·cold', severity: 'warning' };
    default:
      return { text: 'idx·off', severity: 'muted' };
  }
}
