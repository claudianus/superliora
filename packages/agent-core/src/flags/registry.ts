import type { FlagDefinitionInput } from './types';

/**
 * Experimental feature flags.
 *
 * To add one, append an entry and gate runtime behavior through the scoped
 * resolver available on `LioraCore`, `Session`, or `Agent`:
 *   { id: 'my_feature', title: 'My feature', description: '...', env: 'SUPERLIORA_EXPERIMENTAL_MY_FEATURE', default: false, surface: 'both' }
 *
 * Keep the `as const satisfies` — it derives the literal `FlagId` union that gives `enabled()`
 * autocomplete and typo-checking. `env` must start with 'SUPERLIORA_EXPERIMENTAL_', be unique, and
 * not equal the master switch 'SUPERLIORA_EXPERIMENTAL_FLAG'; `id` must not be 'flag'.
 */
export const FLAG_DEFINITIONS = [
  {
    id: 'micro_compaction',
    title: 'Micro compaction',
    description: 'Trim older large tool results from context while keeping recent conversation intact.',
    env: 'SUPERLIORA_EXPERIMENTAL_MICRO_COMPACTION',
    default: true,
    surface: 'core',
  },
  {
    id: 'lean_codegraph_v2',
    title: 'Lean CodeGraph v2',
    description:
      'SQLite + tree-sitter code graph index for LioraIndex/LioraContext. Replaces JSON BM25 with FTS5 and call-graph traversal.',
    env: 'SUPERLIORA_EXPERIMENTAL_LEAN_CODEGRAPH_V2',
    default: true,
    surface: 'core',
  },
  {
    id: 'anthropic_oauth',
    title: 'Anthropic OAuth login',
    description:
      'Show an Anthropic OAuth login option in the provider picker. Disabled by default because Anthropic does not currently authorize third-party CLIs to use its subscription OAuth. Implemented ahead of time so it can be enabled by flipping this flag if the policy changes.',
    env: 'SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH',
    default: false,
    surface: 'core',
  },
  {
    id: 'async_compaction',
    title: 'Async background compaction',
    description:
      'Launch background compaction at a lower context threshold (default 60%) while the turn continues, falling back to synchronous compaction at the regular trigger (80%). Keeps the first two messages (system + initial user) in a frozen zone that is never compacted.',
    env: 'SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION',
    default: false,
    surface: 'core',
  },
] as const satisfies readonly FlagDefinitionInput[];

/** Literal union of registered flag ids. */
export type FlagId = (typeof FLAG_DEFINITIONS)[number]['id'];
