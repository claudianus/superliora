import type { ContentBlock } from '@agentclientprotocol/sdk';

import { detectSlashIntent } from '#/slash';

/** Inspect only the leading text block for ACP-owned slash commands. */
export function detectLeadingSlashIntent(
  blocks: readonly ContentBlock[],
): ReturnType<typeof detectSlashIntent> {
  const first = blocks[0];
  if (!first || first.type !== 'text') return { kind: 'passthrough' };
  return detectSlashIntent(first.text);
}
