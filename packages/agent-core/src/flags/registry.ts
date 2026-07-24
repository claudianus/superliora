import type { FlagDefinitionInput } from './types';

/**
 * Feature flags.
 *
 * Every feature below ships enabled by default; each flag stays as a per-environment
 * kill switch so a misbehaving feature can be turned off without a release. New work
 * should not be gated behind a flag — reach for the scoped resolver on `LioraCore`,
 * `Session`, or `Agent` only when a genuine off switch is needed:
 *   { id: 'my_feature', title: 'My feature', description: '...', env: 'SUPERLIORA_EXPERIMENTAL_MY_FEATURE', default: true, surface: 'both' }
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
      'SQLite + tree-sitter code graph index for LioraSymbol/LioraCallgraph. Replaces JSON BM25 with FTS5 and call-graph traversal.',
    env: 'SUPERLIORA_EXPERIMENTAL_LEAN_CODEGRAPH_V2',
    default: true,
    surface: 'core',
  },
  {
    id: 'anthropic_oauth',
    title: 'Anthropic OAuth login',
    description:
      'Show an Anthropic OAuth login option in the provider picker. Note: Anthropic does not currently authorize third-party CLIs to reuse its subscription OAuth, so tokens may be rejected after the callback. Disable with SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH',
    default: true,
    surface: 'core',
  },
  {
    id: 'async_compaction',
    title: 'Async background compaction',
    description:
      'Background full compaction at ~1% usage while the turn continues; sync at soft trigger (~1.1%). Frozen zone keeps the first two messages (system + initial user).',
    env: 'SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION',
    default: true,
    surface: 'core',
  },
  {
    id: 'auto_dream',
    title: 'Auto-dream memory consolidation',
    description: 'After each user turn, fire a cheap-gated background job that consolidates long-term memory with an LLM without blocking the live session.',
    env: 'SUPERLIORA_EXPERIMENTAL_AUTO_DREAM',
    default: true,
    surface: 'core',
  },
  {
    id: 'auto_pilot',
    title: 'Autopilot issue-to-PR pipeline',
    description: 'Queue-based autonomous repo loop: ingest issues, run agent in a worktree, verify, open PR, poll CI, auto-merge on label, with a repair loop. Disable with SUPERLIORA_EXPERIMENTAL_AUTO_PILOT=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_AUTO_PILOT',
    default: true,
    surface: 'core',
  },
  {
    id: 'prompt_intelligence',
    title: 'Prompt intelligence',
    description: 'Inline next-words autocomplete and next-task suggestions in the TUI prompt box, powered by a lightweight model with thinking off.',
    env: 'SUPERLIORA_EXPERIMENTAL_PROMPT_INTELLIGENCE',
    default: true,
    surface: 'both',
  },
] as const satisfies readonly FlagDefinitionInput[];

/** Literal union of registered flag ids. */
export type FlagId = (typeof FLAG_DEFINITIONS)[number]['id'];
