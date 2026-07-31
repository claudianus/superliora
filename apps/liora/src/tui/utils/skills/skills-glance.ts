/**
 * Skills settings glance — live catalog counts + SearchSkill + risk filter tips (SSOT §9.2).
 */

import type { SkillSummary } from '@superliora/sdk';

export interface SkillsCatalogGlance {
  readonly installedCount: number;
  readonly enabledCount: number;
  readonly disabledCount: number;
  readonly bySource: Readonly<Partial<Record<SkillSummary['source'], number>>>;
}

export interface SkillsGlanceInput {
  readonly homeDir: string;
  readonly catalog?: SkillsCatalogGlance;
  readonly searchSkillActive?: boolean;
}

/** Summarize session catalog + skills-state.json disabled names. */
export function summarizeSkillsCatalog(
  skills: readonly Pick<SkillSummary, 'name' | 'source'>[],
  disabledNames: readonly string[],
): SkillsCatalogGlance {
  const disabled = new Set(disabledNames);
  const bySource: Partial<Record<SkillSummary['source'], number>> = {};
  let enabledCount = 0;
  let disabledCount = 0;
  for (const skill of skills) {
    bySource[skill.source] = (bySource[skill.source] ?? 0) + 1;
    if (disabled.has(skill.name)) disabledCount += 1;
    else enabledCount += 1;
  }
  return {
    installedCount: skills.length,
    enabledCount,
    disabledCount,
    bySource,
  };
}

function formatSourceBreakdown(
  bySource: Readonly<Partial<Record<SkillSummary['source'], number>>>,
): string {
  const parts = (['builtin', 'user', 'project', 'extra'] as const)
    .filter((source) => (bySource[source] ?? 0) > 0)
    .map((source) => `${source} ${String(bySource[source])}`);
  return parts.length > 0 ? parts.join(' · ') : '(none)';
}

export function buildSkillsSettingsLines(input: SkillsGlanceInput): readonly string[] {
  const discoveryLine =
    input.catalog === undefined
      ? 'Installed skills: open a session to count catalog + user/project skills.'
      : `Installed skills: ${String(input.catalog.installedCount)} in catalog · ${String(input.catalog.enabledCount)} slash-enabled · ${String(input.catalog.disabledCount)} disabled in skills-state.json.`;

  const sourceLine =
    input.catalog === undefined
      ? undefined
      : `Catalog sources (live): ${formatSourceBreakdown(input.catalog.bySource)}`;

  const searchSkillLine =
    input.searchSkillActive === true
      ? 'SearchSkill: active in this session (catalog search-only path).'
      : input.searchSkillActive === false
        ? 'SearchSkill: not active — check agent profile / tool waist.'
        : 'SearchSkill: session tool list unavailable (read tips only).';

  return [
    '── Skills (read-only) ────────────────────────',
    'Progressive disclosure — Sovereign Reform §9.2 / §19.',
    '',
    '── Status ───────────────────────────────────',
    discoveryLine,
    ...(sourceLine !== undefined ? [sourceLine] : []),
    searchSkillLine,
    `Home skills dir: ${input.homeDir}/skills`,
    '',
    '── Catalog sources ──────────────────────────',
    '· Builtin catalog — lazy-loaded on first SearchSkill (agent-core catalog/)',
    '· User: ~/.superliora/skills · .agents/skills · .kimi/skills',
    '· Project: .superliora/skills · .agents/skills · .claude/skills (compat scan)',
    '· Plugins may ship skill roots — Extensions → Plugins',
    '',
    '── SearchSkill workflow ─────────────────────',
    '· Model discovers skills via SearchSkill → Skill (not full catalog dump)',
    '· Use 3–12 concise English task keywords; retry with broader terms if weak',
    '· Locale-specific skills are discovered, not hardcoded in Settings',
    '',
    '── Risk filter ──────────────────────────────',
    '· metadata.risk=high skills are excluded from SearchSkill results',
    '· Inline/prompt skills only; reference/expert types use different paths',
    '· disableModelInvocation=true skills never appear in model search',
    '',
    '── Trace→Skill (tips only) ──────────────────',
    '· Session end may suggest skill drafts — manual merge only (no auto pipeline)',
    '· Drafts stay out of SearchSkill until you edit + move to ~/.superliora/skills',
    '· No skill PR bot yet — copy/paste stubs or Extensions → Skills install',
    '',
    '── Manage (manual) ──────────────────────────',
    '· Extensions → Skills — enable/disable slash activation',
    '· Import from Claude Code — ~/.claude/skills → ~/.superliora/skills',
    '· Claude plugins — <dir>/.claude-plugin/plugin.json → Extensions → Plugins install',
    '· Hot-reload: install/toggle/import reloads session · footer ext↻ badge (~45s)',
    '· Stuck? Extensions → MCP → Reload session · or /reload',
    '· /skills — list slash-discoverable skills in transcript',
    '',
    'No catalog rebuild or risk override toggles here yet.',
  ];
}
