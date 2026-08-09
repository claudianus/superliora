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
    id: 'anthropic_oauth',
    title: 'Anthropic OAuth login',
    description:
      'Show an Anthropic OAuth login option in the provider picker. Note: Anthropic does not currently authorize third-party CLIs to reuse its subscription OAuth, so tokens may be rejected after the callback. Disable with SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH',
    default: true,
    surface: 'core',
  },
  {
    id: 'cursor_oauth',
    title: 'Cursor OAuth login',
    description:
      'Show a Cursor account login option in the provider picker. Uses reverse-engineered Cursor CLI OAuth + Connect-RPC (unofficial); Cursor may reject third-party clients or change the wire without notice. Disable with SUPERLIORA_EXPERIMENTAL_CURSOR_OAUTH=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_CURSOR_OAUTH',
    default: true,
    surface: 'core',
  },
  {
    id: 'micro_compaction',
    title: 'Micro compaction',
    description:
      'Claude Code–style tool-result clearing: replace older bulky tool dumps with receipts while keeping recent turns intact (zero LLM cost). Disable with SUPERLIORA_EXPERIMENTAL_MICRO_COMPACTION=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_MICRO_COMPACTION',
    default: true,
    surface: 'core',
  },
  {
    id: 'async_compaction',
    title: 'Async background compaction',
    description:
      'Background full compaction starts near 55% usage (70% on large windows); the blocking path starts near 70% (80% on large windows). The frozen head preserves the first real user message when it fits.',
    env: 'SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION',
    default: true,
    surface: 'core',
  },
  {
    id: 'auto_dream',
    title: 'Liora Memory reflection',
    description: 'After each user turn, use a cheap-gated background job to promote candidate records through deterministic reflection without blocking the live session.',
    env: 'SUPERLIORA_EXPERIMENTAL_AUTO_DREAM',
    default: true,
    surface: 'core',
  },
  {
    id: 'auto_refine',
    title: 'Auto harness refinement',
    description: 'Every 10 turns (and after compactions), a cheap review-gate model decides whether the recent trajectory holds a reusable lesson; only then does a refine run apply small harness edits (prompt notes, memory, skills, subagent specs) with rollback support. At most one auto attempt per 5 minutes. Manual /refine works regardless. Disable with SUPERLIORA_EXPERIMENTAL_AUTO_REFINE=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_AUTO_REFINE',
    default: true,
    surface: 'core',
  },
  {
    id: 'auto_skillify',
    title: 'Auto skill from trajectory',
    description: 'After turns with tool retry/recovery patterns, write reusable SKILL.md files under .agents/skills/auto/ and register them live. Cooldown 5 minutes. Disable with SUPERLIORA_EXPERIMENTAL_AUTO_SKILLIFY=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_AUTO_SKILLIFY',
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
  {
    id: 'conductor_ux_v2',
    title: 'Conductor UX v2 control tower',
    description:
      'Job RPC hotpath, Inbox drawer, Timeline, Intent Composer, Merge Preview, Worker Dock naming. Disable with SUPERLIORA_EXPERIMENTAL_CONDUCTOR_UX_V2=false.',
    env: 'SUPERLIORA_EXPERIMENTAL_CONDUCTOR_UX_V2',
    default: true,
    surface: 'both',
  },
] as const satisfies readonly FlagDefinitionInput[];

/** Literal union of registered flag ids. */
export type FlagId = (typeof FLAG_DEFINITIONS)[number]['id'];
