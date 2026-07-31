/**
 * Settings → Never-Halt — resilience contract glance (Sovereign Reform W14).
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { buildNeverHaltOAuthResilienceLines, resolveOAuthPoolGlance } from '../../utils/never-halt/auth-glance';
import { resolveNeverHaltBreakerLines } from '../../utils/never-halt/breaker-glance';
import { formatInterventionQueueSettingsLine } from '../../utils/never-halt/intervention-glance';
import { activeRuntimeDegraded } from '../../utils/never-halt/runtime-degraded';

import type { SlashCommandHost } from '../hub/dispatch';
import { detectSearchProviderEnvKeys } from './search-status';

export async function showNeverHaltSettings(host: SlashCommandHost): Promise<void> {
  const search = detectSearchProviderEnvKeys();
  const degraded = activeRuntimeDegraded(host.state.appState.runtimeDegraded);

  let breakerLines = resolveNeverHaltBreakerLines({
    appStateBreakers: host.state.appState.circuitBreakers,
    degraded,
  });
  let oauthPoolGlance = resolveOAuthPoolGlance(
    undefined,
    host.state.appState.availableProviders,
    host.state.appState.model.trim().length > 0
      ? host.state.appState.availableModels[host.state.appState.model]?.provider
      : undefined,
  );
  let interventionQueueLine = formatInterventionQueueSettingsLine({
    sessionUnavailable: true,
  });
  try {
    const status = await host.requireSession().getStatus();
    breakerLines = resolveNeverHaltBreakerLines({
      appStateBreakers: host.state.appState.circuitBreakers,
      statusBreakers: status.circuitBreakers,
      degraded,
    });
    oauthPoolGlance = resolveOAuthPoolGlance(
      status,
      host.state.appState.availableProviders,
      host.state.appState.model.trim().length > 0
        ? host.state.appState.availableModels[host.state.appState.model]?.provider
        : undefined,
    );
    interventionQueueLine = formatInterventionQueueSettingsLine({
      pendingInterventions: status.pendingInterventions,
      staleInterventions: status.staleInterventions,
      oldestInterventionAgeMs: status.oldestInterventionAgeMs,
    });
  } catch {
    /* keep degraded-only fallback */
  }

  const lines = [
    '── Never-Halt contract ─────────────────────',
    'Goal/Mission/Fleet survive transient faults —',
    'degrade, retry, alternate path; never hard-stop.',
    '',
    '── Search free fallback ────────────────────',
    search.configured.length > 0
      ? `Paid channels: ${search.configured.join(', ')} · free fallback ON by default`
      : 'No paid API keys — DDG/local free fallback keeps WebSearch alive',
    'Settings → Search toggles research.search.freeFallback.',
    'WebSearch/DeepResearch return degraded hints, not throws.',
    '',
    ...buildNeverHaltOAuthResilienceLines(oauthPoolGlance),
    '',
    '── Session (live) ───────────────────────────',
    interventionQueueLine,
    '',
    '── Permission intervention queue ───────────',
    'High-risk approvals queue non-blocking —',
    'Goal/Mission/Fleet keep running while tray waits.',
    'Independent tool_calls fan out in parallel;',
    'only conflicting resource accesses serialize.',
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
    'Failures emit runtime.degraded for Ops/footer.',
    ...breakerLines,
    '',
    '── Live signals ────────────────────────────',
    'Footer + /ops glance (TTL badges):',
    '· search↓ — search channel degraded',
    '· oauth↓ — token refresh needed',
    '· cache✓ — prompt cache ≥99% hit (×N streak)',
    '· breakers — Ops Breakers: open/half/closed',
    '· stale×N — Ops tray interventions aging',
    '· queue depth + oldest age — /ops intervention tray',
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
    'Run /ops for live Goal · git · MCP · approval tray.',
  ];

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => lines,
    borderToken: 'primary',
    title: ' Never-Halt ',
    enterBeatSeed: 'never-halt',
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
