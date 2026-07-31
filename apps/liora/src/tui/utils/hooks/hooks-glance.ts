/**
 * Hooks settings glance — live HookEngine registry + Pre/Post/Stop tips (SSOT §9.2).
 */

export interface HooksGlanceInput {
  readonly registry?: {
    readonly totalCount: number;
    readonly events: Readonly<Record<string, number>>;
  };
  readonly pluginHookCount?: number;
  readonly enabledPluginCount?: number;
  readonly configPath: string;
}

/** Compact event×count summary for the live registry line. */
export function formatHookEventSummary(events: Readonly<Record<string, number>>): string {
  const entries = Object.entries(events)
    .filter(([, count]) => count > 0)
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return '(no hooks registered)';
  return entries.map(([event, count]) => `${event}×${String(count)}`).join(' · ');
}

export function buildHooksSettingsLines(input: HooksGlanceInput): readonly string[] {
  const pluginLine =
    input.pluginHookCount === undefined
      ? 'Plugin hooks: open a session to count enabled plugin hooks.'
      : `Plugin hooks: ${String(input.pluginHookCount)} from ${String(input.enabledPluginCount ?? 0)} enabled plugin(s).`;

  const registryLines =
    input.registry === undefined
      ? []
      : [
          '── Live registry (HookEngine) ───────────────',
          `· ${String(input.registry.totalCount)} hook(s) — ${formatHookEventSummary(input.registry.events)}`,
          ...(input.registry.totalCount === 0
            ? ['· Engine empty — add [[hooks]] in config or enable plugin hooks']
            : []),
          '',
        ];

  return [
    '── Hooks (read-only) ─────────────────────────',
    'Claude-compatible lifecycle hooks — Sovereign Reform §9.2.',
    '',
    ...registryLines,
    '── Status ───────────────────────────────────',
    ...(input.registry !== undefined
      ? [`Registered hooks: ${String(input.registry.totalCount)} in HookEngine`]
      : []),
    pluginLine,
    `User hooks: config.toml [[hooks]] at ${input.configPath}`,
    'Project checks on edit: plugin PreToolUse hooks + permission policies.',
    '',
    '── Key events (tips) ────────────────────────',
    '· PreToolUse — gate destructive git/rm, .env writes, secret paths',
    '· PostToolUse / PostToolUseFailure — audit, format, telemetry side-effects',
    '· PostToolUse (Edit/Write) — RunProjectChecks or scoped lint/type after file changes',
    '· Stop / StopFailure — session wind-down, teammate idle, swarm cleanup',
    '· SessionStart / UserPromptSubmit — bootstrap context, expand prompts',
    '',
    '── Enable (manual) ──────────────────────────',
    '· Edit config.toml [[hooks]] (command hooks) — restart after changes',
    '· Plugin hooks: Extensions → Plugins (enable plugin with hooks/hooks.json)',
    '· Audit live hooks: /ext hooks or Extensions modal → Hooks tab',
    '· Claude import: nested hooks via hooks-adapter (plugin manifest)',
    '',
    'No Pre/Post/Stop toggles here until hook editor lands.',
  ];
}
