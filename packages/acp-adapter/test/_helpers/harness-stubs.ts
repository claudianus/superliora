/** Native harness auth and model-catalog fixtures shared by ACP tests. */

import type { ModelAlias } from '@superliora/sdk';

/** Stub `auth.status()` payload for an authenticated harness. */
export const AUTHED_STATUS = {
  providers: [{ providerName: 'kimi', hasToken: true }],
} as const;

/** Stub `auth.status()` payload for an unauthenticated harness. */
export const UNAUTHED_STATUS = {
  providers: [{ providerName: 'kimi', hasToken: false }],
} as const;

/**
 * Build a `Record<string, ModelAlias>` suitable for stubbing
 * `harness.getConfig().models`. Each input entry maps to one alias;
 * `capabilities: ['thinking']` is added when `thinkingSupported` is
 * true so `deriveThinkingSupported` (in `src/model-catalog.ts`) reads
 * it back correctly — this opts out of the name-regex and
 * allow-list heuristics in favour of an explicit declaration that
 * mirrors what a real config file would carry.
 */
export function makeModelsMap(
  entries: ReadonlyArray<{
    id: string;
    name?: string;
    thinkingSupported?: boolean;
    alwaysThinking?: boolean;
  }>,
): Record<string, ModelAlias> {
  const out: Record<string, ModelAlias> = {};
  for (const entry of entries) {
    const capabilities = entry.alwaysThinking === true
      ? ['thinking', 'always_thinking']
      : entry.thinkingSupported === true
        ? ['thinking']
        : undefined;
    out[entry.id] = {
      provider: 'kimi',
      maxContextSize: 200_000,
      model: entry.id,
      ...(entry.name !== undefined ? { displayName: entry.name } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
    };
  }
  return out;
}
