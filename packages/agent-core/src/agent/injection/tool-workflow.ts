/**
 * Hard tool / skill / research workflow contract.
 *
 * Distilled from harness research (Anthropic long-running agents + skills
 * progressive disclosure, context engineering attention budget, OpenAI
 * harness engineering: make capabilities legible and enforceable). Soft
 * system-prompt prose alone is not enough — re-inject near the context tail
 * so multi-step loops actually use SearchSkill, WebSearch, and dedicated tools.
 */

export type ToolWorkflowCapability = {
  readonly hasSearchSkill: boolean;
  readonly hasSearchTools: boolean;
  readonly hasSkill: boolean;
  readonly hasWebSearch: boolean;
  readonly hasFetchUrl: boolean;
  readonly hasContext7: boolean;
  readonly hasLeanRead: boolean;
  readonly hasVerifySurface: boolean;
  readonly hasRunProjectChecks: boolean;
  readonly hasTodoList: boolean;
  readonly hasMemory: boolean;
};

const TOOL_CAPABILITY_NAMES = {
  SearchSkill: 'hasSearchSkill',
  SearchTools: 'hasSearchTools',
  Skill: 'hasSkill',
  WebSearch: 'hasWebSearch',
  FetchURL: 'hasFetchUrl',
  Context7Resolve: 'hasContext7',
  Context7Docs: 'hasContext7',
  RepoQuery: 'hasLeanRead',
  LioraRead: 'hasLeanRead',
  LioraSymbol: 'hasLeanRead',
  LioraTree: 'hasLeanRead',
  LioraCallgraph: 'hasLeanRead',
  Expand: 'hasLeanRead',
  LioraExpand: 'hasLeanRead',
  VerifySurface: 'hasVerifySurface',
  RunProjectChecks: 'hasRunProjectChecks',
  TodoList: 'hasTodoList',
  Memory: 'hasMemory',
} as const satisfies Record<string, keyof ToolWorkflowCapability>;

export function resolveToolWorkflowCapability(
  toolNames: readonly string[],
): ToolWorkflowCapability {
  const set = new Set(toolNames);
  const cap: Record<keyof ToolWorkflowCapability, boolean> = {
    hasSearchSkill: false,
    hasSearchTools: false,
    hasSkill: false,
    hasWebSearch: false,
    hasFetchUrl: false,
    hasContext7: false,
    hasLeanRead: false,
    hasVerifySurface: false,
    hasRunProjectChecks: false,
    hasTodoList: false,
    hasMemory: false,
  };
  for (const name of set) {
    const key = TOOL_CAPABILITY_NAMES[name as keyof typeof TOOL_CAPABILITY_NAMES];
    if (key !== undefined) cap[key] = true;
  }
  return cap;
}

/** True when at least one enforceable capability is present. */
export function hasToolWorkflowSurface(cap: ToolWorkflowCapability): boolean {
  return (
    cap.hasSearchSkill ||
    cap.hasSearchTools ||
    cap.hasSkill ||
    cap.hasWebSearch ||
    cap.hasFetchUrl ||
    cap.hasContext7 ||
    cap.hasLeanRead ||
    cap.hasVerifySurface ||
    cap.hasRunProjectChecks ||
    cap.hasTodoList
  );
}

/**
 * Build a dense, actionable reminder. Lines are capability-gated so profiles
 * without WebSearch/Skill are not told to call missing tools.
 */
export function buildToolWorkflowGuidance(cap: ToolWorkflowCapability): string {
  const lines: string[] = [
    'Tool / Skill / Research Workflow (MANDATORY — soft prompts are not enough):',
    '- Default to tools for any workspace, code, research, or multi-step task. Text-only only for pure chat with no file/system/internet need.',
    '- Prefer dedicated tools over raw Bash when they fit (Read/Write/Edit/Grep/Glob/list). Shell is for real process semantics, not file I/O.',
    '- File content: use Write/Edit — do not cat/echo/printf redirect, heredoc, tee, dd if=/of=, install src dest, empty redirects (`: > file`), or python/node/bun/deno/ruby/php/perl/lua -c/-e/-r/-p writeFile/open-write one-liners through Bash (runtime-blocked).',
    '- File reads: use Read — do not python/node/bun/deno/ruby/php/perl/lua -c/-e/-r/-p open/readFile one-liners, macOS `md5`/`plutil`/`PlistBuddy -c Print`/`xmllint` single-file dumps, perl/ruby -ne/-pe line loops, or bat/tac/rev/paste/sed -n/awk/base64/fmt/pr/fold dumps, for file contents (runtime-blocked).',
    '- Secrets: never cat/source/base64 .env, SSH keys, or cloud credentials via Bash (hard-blocked, no force escape).',
    '- Parallelize independent reads/searches in one turn. Serial only when a later call needs earlier output.',
    '- Small verifiable steps: change → check → continue. Leave clean artifacts (tests green, notes, evidence) for the next turn/session.',
  ];

  if (cap.hasLeanRead) {
    lines.push(
      '- Codebase: RepoQuery (content/path/symbol/outline) before full Read dumps; expand archived overflow only on failure paths.',
    );
  }

  if (cap.hasSearchTools) {
    lines.push(
      '- Tool inventory: SearchTools when unsure which dedicated tool fits — prefer registry tools over improvising with Bash.',
    );
  }

  if (cap.hasSearchSkill || cap.hasSkill) {
    lines.push(
      '- Skills (progressive disclosure): SearchSkill with 3–12 concise English task keywords first; then Skill(exact name). Never invent skill names or call Skill with "search". Reuse already-loaded <kimi-skill-loaded> content. Apply selectively — AGENTS.md and repo facts win.',
    );
  }

  if (cap.hasWebSearch || cap.hasFetchUrl || cap.hasContext7) {
    const parts: string[] = [];
    if (cap.hasContext7) parts.push('Context7Resolve → Context7Docs for library APIs');
    if (cap.hasWebSearch) parts.push('WebSearch for CVEs/releases/papers/news (year from GetCurrentTime / <current_time>)');
    if (cap.hasFetchUrl) parts.push('FetchURL on primary URLs before trusting snippets');
    lines.push(`- Research when pretrained knowledge may be stale: ${parts.join('; ')}. Re-search when uncertainty returns. Cite URLs that drive recommendations.`);
  }

  if (cap.hasTodoList) {
    lines.push(
      '- Multi-step work: keep TodoList as the live Kanban (verb + target); one in_progress; mark done only after verification.',
    );
  }

  if (cap.hasRunProjectChecks || cap.hasVerifySurface) {
    const verify: string[] = [];
    if (cap.hasRunProjectChecks) verify.push('RunProjectChecks / package test|typecheck|build');
    if (cap.hasVerifySurface) verify.push('VerifySurface for real UI when browser runtime is healthy');
    lines.push(`- Before claiming done: ${verify.join('; ')}. No "done" without evidence.`);
  }

  if (cap.hasMemory) {
    lines.push(
      '- Memory: durable decisions/preferences only — not raw transcripts or archived tool dumps.',
    );
  }

  const available: string[] = [];
  if (cap.hasSearchTools) available.push('SearchTools');
  if (cap.hasSearchSkill) available.push('SearchSkill');
  if (cap.hasWebSearch) available.push('WebSearch');
  if (cap.hasContext7) available.push('Context7');
  if (cap.hasLeanRead) available.push('RepoQuery');
  if (cap.hasFetchUrl) available.push('FetchURL');
  if (available.length > 0) {
    lines.push(
      `- Do not skip ${available.join('/')} out of habit when the task needs them; harness power comes from using the full tool surface.`,
    );
  } else {
    lines.push(
      '- Use the full available tool surface — do not leave dedicated tools idle out of habit.',
    );
  }

  return lines.join('\n');
}

/** Sparse checkpoint — short enough to re-inject often without flooding. */
export function buildToolWorkflowSparseGuidance(cap: ToolWorkflowCapability): string {
  const bits: string[] = ['Tool workflow still ON:'];
  if (cap.hasSearchTools) bits.push('SearchTools');
  if (cap.hasSearchSkill) bits.push('SearchSkill→Skill');
  if (cap.hasWebSearch || cap.hasFetchUrl) bits.push('WebSearch/FetchURL when stale');
  if (cap.hasContext7) bits.push('Context7 for libs');
  if (cap.hasLeanRead) bits.push('RepoQuery before dumps');
  bits.push('dedicated tools > Bash');
  bits.push('Write≠shell I/O');
  bits.push('no secret shell');
  bits.push('verify before done');
  return bits.join(' · ');
}
