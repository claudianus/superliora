/**
 * Compact repo-index footer pill — engine gate + codemap warmth (Settings → Index SSOT).
 */
import { getCodemapStatus, getRepoIndexStatus } from '@superliora/sdk';

import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import { labelIndex } from '#/tui/components/chrome/footer/footer-labels';
import type { FooterLabels } from '#/tui/config';

export function formatIndexFooterBadge(
  workDir: string,
  env: NodeJS.ProcessEnv = process.env,
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  const dir = workDir.trim();
  if (dir.length === 0) return null;

  const repoIndex = getRepoIndexStatus(env);
  if (repoIndex.engine === 'stub') {
    return { text: labelIndex(labels, 'stub'), severity: 'muted' };
  }

  const codemap = getCodemapStatus(dir);
  switch (codemap.warmth) {
    case 'warm':
      return { text: labelIndex(labels, 'warm'), severity: 'info' };
    case 'cold':
      return { text: labelIndex(labels, 'cold'), severity: 'warning' };
    default:
      return { text: labelIndex(labels, 'off'), severity: 'muted' };
  }
}
