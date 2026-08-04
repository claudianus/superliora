/**
 * Never-Halt settings glance — resilience contract panel + compact picker tips (SSOT W14).
 */

import { buildNeverHaltOAuthResilienceLines, type OAuthPoolGlanceLike } from './auth-glance';
import {
  INTERVENTION_ASK_MODE_FLEET_TIP,
  INTERVENTION_PARALLEL_TOOLS_NOTE,
} from './intervention-glance';
import type { RuntimeDegradedLike } from './breaker-summary';

/** Compact search free-fallback tip — Settings → Search toggle + default-on contract. */
export const NEVER_HALT_SEARCH_FALLBACK_TIP =
  'Search free fallback: default ON ($0 DDG/local keeps WebSearch alive) · Settings → Search → Free fallback · research.search.freeFallback · WebSearch/DeepResearch return degraded hints, not throws.';

/** Compact OAuth proactive refresh tip — pool failover + /login. */
export const NEVER_HALT_OAUTH_TIP =
  'OAuth proactive refresh: host polls ensureFresh before expiry · multi-account pool fails over on 401/quota · oauth↓ badge when refresh fails — Goal continues · /login --add or Settings → Accounts for fallback slots.';

/** Compact permission intervention queue tip — non-blocking approvals. */
export const NEVER_HALT_INTERVENTION_TIP =
  `${INTERVENTION_ASK_MODE_FLEET_TIP} ${INTERVENTION_PARALLEL_TOOLS_NOTE} yolo skips ask; auto queues sticky approvals · opt-in SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS drops orphaned tray entries only.`;

/** Compact circuit breaker tip — per-provider trips + half-open probe. */
export const NEVER_HALT_BREAKER_TIP =
  'Circuit breaker: per-provider opens on repeated 5xx/429 · traffic routes to fallbackModels until cooldown · half-open probe after cooldown — success closes, failure reopens · failures emit runtime.degraded for Ops/footer.';

export interface NeverHaltSearchGlance {
  readonly configuredPaidChannels: readonly string[];
}

export interface NeverHaltSettingsGlanceInput {
  readonly search: NeverHaltSearchGlance;
  readonly oauthPoolGlance?: OAuthPoolGlanceLike | null;
  readonly interventionQueueLine: string;
  readonly breakerLines: readonly string[];
  readonly degraded?: RuntimeDegradedLike | null;
  readonly nowMs?: number;
}

/** Settings → Never-Halt status panel lines (live glance preserved). */
export function buildNeverHaltSettingsLines(input: NeverHaltSettingsGlanceInput): readonly string[] {
  const { search, oauthPoolGlance, interventionQueueLine, breakerLines, degraded } = input;
  const nowMs = input.nowMs ?? Date.now();

  return [
    '── Never-Halt contract ─────────────────────',
    'Goal/Mission/Fleet survive transient faults —',
    'degrade, retry, alternate path; never hard-stop.',
    '',
    '── Search free fallback ────────────────────',
    search.configuredPaidChannels.length > 0
      ? `Paid channels: ${search.configuredPaidChannels.join(', ')} · free fallback ON by default`
      : 'No paid API keys — DDG/local free fallback keeps WebSearch alive',
    'Settings → Search toggles research.search.freeFallback.',
    'WebSearch/DeepResearch return degraded hints, not throws.',
    '',
    ...buildNeverHaltOAuthResilienceLines(oauthPoolGlance, nowMs),
    '',
    '── Session (live) ───────────────────────────',
    interventionQueueLine,
    '',
    '── Permission intervention queue ───────────',
    INTERVENTION_ASK_MODE_FLEET_TIP,
    'High-risk approvals queue non-blocking —',
    'Goal/Mission/Fleet keep running while tray waits.',
    INTERVENTION_PARALLEL_TOOLS_NOTE,
    'Only conflicting resource accesses serialize.',
    'yolo skips ask; auto still queues interventions.',
    'Sticky interrupts stay in the approval tray.',
    'Unattended runs prefer auto/yolo; AskUserQuestion stays sticky in Ops tray when ask mode applies.',
    'Opt-in: SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS drops orphaned tray entries only — never in-flight RPC.',
    '',
    '── Security tip ────────────────────────────',
    'Full glance: Settings → Security (sandbox, redaction, MCP allowlist).',
    'Secrets: .env/SSH/cloud creds hard-blocked in Bash (no force escape).',
    'Paths: Read/Write/Edit stay inside workspace roots (profile workspace / read-only).',
    'MCP tool allowlists: enabledTools/disabledTools in mcp.json — Settings → MCP.',
    'Prefer yolo only in trusted workspaces; auto queues sticky approvals in Ops tray.',
    '',
    '── Circuit breaker ─────────────────────────',
    'Per-provider breaker opens on repeated 5xx/429;',
    'traffic routes to fallbackModels until cooldown.',
    'Half-open: one probe after cooldown — success closes, failure reopens.',
    'Failures emit runtime.degraded for the footer.',
    ...breakerLines,
    '',
    '── Live signals ────────────────────────────',
    'Footer glance (TTL badges):',
    '· search↓ — search channel degraded',
    '· oauth↓ — token refresh needed',
    '· cache✓ — prompt cache ≥99% hit (×N streak)',
    '· breakers — Ops Breakers: open/half/closed',
    '· stale×N — interventions aging',
    '· queue depth + oldest age — intervention queue',
    '· research↻ — recent WebSearch/DeepResearch cascade',
    '',
    '── Live monitor ────────────────────────────',
    degraded != null
      ? `Now: ${degraded.scope}↓ · ${degraded.reason}${
          degraded.hint != null && degraded.hint.trim().length > 0
            ? ` · hint: ${degraded.hint.trim()}`
            : ''
        }`
      : 'Now: (no active degradation)',
  ];
}
