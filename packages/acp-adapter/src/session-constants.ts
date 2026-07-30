/**
 * Shared constants for {@link AcpSession} and its sibling modules
 * (`session-prompt.ts`, `session-commands.ts`, `session-lifecycle.ts`).
 * Pulled out on their own so the siblings never need to import from
 * `session.ts` itself, avoiding a circular module graph.
 */

/**
 * Identifier the agent-core session emits for the main (user-facing)
 * agent. Subagents are issued generated ids by `Session.spawnAgent`;
 * filtering on this constant keeps `turn.ended` / `error` events from a
 * child agent from settling the parent's `session/prompt` promise.
 */
export const MAIN_AGENT_ID = 'main';

/**
 * Effort-level strings passed to {@link Session.setThinking} when the
 * ACP `thinking` toggle flips. Phase 15 wired the ACP-side binary axis
 * (then a `SessionConfigBoolean`; Phase 16 reshaped it to a 2-entry
 * `select` `off` / `on` for Zed UI compatibility) to the SDK's
 * effort-level channel: `true` → `'high'` (kimi-code's typical default,
 * also `resolveThinkingEffort`'s fallback), `false` → `'off'`. The
 * granularity of `'low' | 'medium' | 'xhigh' | 'max'` is intentionally
 * not exposed — the ACP `thinking` axis is binary.
 */
export const THINKING_ON_LEVEL = 'high';
export const THINKING_OFF_LEVEL = 'off';
