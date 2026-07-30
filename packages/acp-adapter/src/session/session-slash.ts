import type { ContentBlock } from '@agentclientprotocol/sdk';

import { detectSlashIntent } from '#/slash';

/**
 * Inspect the leading `ContentBlock` of an ACP prompt for a
 * `/skill:<name>` form. Only the first block is examined — when Zed
 * (or any other ACP client) sends a slash command, it always lives in
 * the first text block; multi-part prompts that interleave images or
 * resources before text are typed by humans and do not start with a
 * slash. Non-text leading blocks short-circuit to passthrough.
 *
 * The parsing/resolution itself is delegated to `./slash` —
 * deliberately duplicated from the TUI's
 * `apps/liora/src/tui/commands/parse.ts` and `resolve.ts` to
 * avoid an app→package import inversion. See `./slash`'s top-of-file
 * comment for the sync target.
 */
export function detectLeadingSlashIntent(
  blocks: readonly ContentBlock[],
  skillCommandMap: ReadonlyMap<string, string>,
): ReturnType<typeof detectSlashIntent> {
  const first = blocks[0];
  if (!first || first.type !== 'text') return { kind: 'passthrough' };
  return detectSlashIntent(first.text, skillCommandMap);
}
