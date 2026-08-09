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
  readonly hasBrowserUse: boolean;
  readonly hasComputerUse: boolean;
  readonly hasAgent: boolean;
  readonly hasJob: boolean;
  readonly hasVerifySurface: boolean;
  readonly hasRunProjectChecks: boolean;
  readonly hasTodoList: boolean;
  readonly hasMemory: boolean;
  /** Programmatic tool calling (Prime PTC / Script). */
  readonly hasScript: boolean;
  /** Agent-initiated compaction mid-turn. */
  readonly hasCompact: boolean;
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
  BrowserStatus: 'hasBrowserUse',
  BrowserObserve: 'hasBrowserUse',
  BrowserAct: 'hasBrowserUse',
  BrowserScreenshot: 'hasBrowserUse',
  BrowserConsole: 'hasBrowserUse',
  ComputerStatus: 'hasComputerUse',
  ComputerCapture: 'hasComputerUse',
  ComputerAct: 'hasComputerUse',
  Agent: 'hasAgent',
  JobCreate: 'hasJob',
  JobSteer: 'hasJob',
  JobInbox: 'hasJob',
  VerifySurface: 'hasVerifySurface',
  RunProjectChecks: 'hasRunProjectChecks',
  TodoList: 'hasTodoList',
  Memory: 'hasMemory',
  Script: 'hasScript',
  Compact: 'hasCompact',
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
    hasBrowserUse: false,
    hasComputerUse: false,
    hasAgent: false,
    hasJob: false,
    hasVerifySurface: false,
    hasRunProjectChecks: false,
    hasTodoList: false,
    hasMemory: false,
    hasScript: false,
    hasCompact: false,
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
    cap.hasBrowserUse ||
    cap.hasComputerUse ||
    cap.hasAgent ||
    cap.hasJob ||
    cap.hasVerifySurface ||
    cap.hasRunProjectChecks ||
    cap.hasTodoList ||
    cap.hasMemory ||
    cap.hasScript ||
    cap.hasCompact
  );
}

/**
 * Build a dense, actionable reminder. Lines are capability-gated so profiles
 * without WebSearch/Skill are not told to call missing tools.
 */
export function buildToolWorkflowGuidance(cap: ToolWorkflowCapability): string {
  // Keep this denser than system.md: runtime-blocked Bash I/O + capability gates.
  // Do not restate the full Accuracy / Execution Loop — those live in the system prompt.
  const lines: string[] = [
    'Tool / Skill / Research Workflow (MANDATORY — soft prompts are not enough):',
    '- Default to tools for workspace/code/research/multi-step work. Prefer dedicated tools over Bash for file I/O (Write/Edit/Read — shell redirects and interpreter one-liner dumps are runtime-blocked). Secrets never via Bash.',
    '- Parallelize independent reads/searches. Explore before edit; one verifiable increment per batch; fix root causes; no "done" without receipts.',
  ];

  if (cap.hasLeanRead) {
    lines.push(
      '- Codebase: RepoQuery (content/path/symbol/outline) before full Read dumps; expand archived overflow only on failure paths.',
    );
  }

  if (cap.hasScript) {
    lines.push(
      '- Bulk N≳10 same op (read/transform/aggregate/fan-out): Script(read/write/glob/exec[/agent]); keep raw in store/files; return aggregates only — never Bash-loop or per-item Read dumps into context.',
    );
  }

  if (cap.hasCompact) {
    lines.push(
      '- Context bloated mid-task: Compact(action=run) before another large read/search wave (waits until apply); Compact(action=status) shows pendingApply.',
    );
  }

  if (cap.hasSearchTools) {
    lines.push(
      '- Tool inventory: SearchTools when unsure which dedicated tool fits — prefer registry tools over improvising with Bash.',
    );
  }

  if (cap.hasSearchSkill || cap.hasSkill) {
    lines.push(
      '- Skills (progressive disclosure): SearchSkill with 3–12 concise English task keywords first; then Skill(exact name). Never invent skill names or call Skill with "search". Reuse already-loaded <liora-skill-loaded> content. Apply selectively — AGENTS.md and repo facts win. Prefer builtin harness playbooks (browser-use / research-use / computer-use / git-safe / agent-job / project-checks) over catalog install scripts.',
    );
  }

  if (cap.hasBrowserUse) {
    lines.push(
      '- Browser / UI: BrowserStatus → BrowserObserve → BrowserAct(click_ref) → VerifySurface. Skill("browser-use") for the playbook. Never npm/npx install Playwright/Puppeteer or handwritten Chromium scripts while these tools exist. Re-Observe after DOM changes; Act ok:false is failure — do not invent success.',
    );
  }

  if (cap.hasComputerUse) {
    lines.push(
      '- Desktop GUI: ComputerStatus → ComputerCapture(som) → ComputerAct(element indexes). Skill("computer-use"). Never install pyautogui / external CUA / Playwright for desktop while these tools exist.',
    );
  }

  if (cap.hasWebSearch || cap.hasFetchUrl || cap.hasContext7) {
    const parts: string[] = [];
    if (cap.hasContext7) parts.push('Context7Resolve → Context7Docs for library APIs');
    if (cap.hasWebSearch) parts.push('WebSearch for CVEs/releases/papers/news (year from GetCurrentTime / <current_time>)');
    if (cap.hasFetchUrl) parts.push('FetchURL on primary URLs before trusting snippets');
    lines.push(
      `- Research when pretrained knowledge may be stale: ${parts.join('; ')}. Skill("research-use"). Never run catalog web-search/tavily/serpapi/context7 shell scripts while these tools exist. Re-search when uncertainty returns. Cite URLs that drive recommendations.`,
    );
  }

  if (cap.hasAgent || cap.hasJob) {
    const bits: string[] = [];
    if (cap.hasAgent) bits.push('Agent');
    if (cap.hasJob) bits.push('JobCreate/JobSteer/JobInbox');
    lines.push(
      `- Workers: ${bits.join(' + ')}. Skill("agent-job"). Do not install catalog swarm/subagent frameworks for ordinary harness delegation.`,
    );
  }

  if (cap.hasTodoList) {
    lines.push(
      '- Multi-step work: keep TodoList as the live Kanban (verb + target); one in_progress; mark done only after verification.',
    );
  }

  if (cap.hasRunProjectChecks || cap.hasVerifySurface || cap.hasBrowserUse) {
    const verify: string[] = [];
    if (cap.hasRunProjectChecks) {
      verify.push('RunProjectChecks / package test|typecheck|build (Skill("project-checks"))');
    }
    if (cap.hasVerifySurface) {
      verify.push('VerifySurface for real UI (BrowserScreenshot alone is not visual proof)');
    } else if (cap.hasBrowserUse) {
      verify.push('BrowserObserve/Act evidence when VerifySurface is unavailable');
    }
    lines.push(`- Before claiming done: ${verify.join('; ')}. No "done" without evidence.`);
  }

  if (cap.hasMemory) {
    lines.push(
      '- Memory: durable decisions/preferences only — not raw transcripts or archived tool dumps. Prefer the Memory tool over catalog agent-memory installs.',
    );
  }

  const available: string[] = [];
  if (cap.hasSearchTools) available.push('SearchTools');
  if (cap.hasSearchSkill) available.push('SearchSkill');
  if (cap.hasWebSearch) available.push('WebSearch');
  if (cap.hasContext7) available.push('Context7');
  if (cap.hasLeanRead) available.push('RepoQuery');
  if (cap.hasFetchUrl) available.push('FetchURL');
  if (cap.hasBrowserUse) available.push('Browser*');
  if (cap.hasComputerUse) available.push('Computer*');
  if (cap.hasScript) available.push('Script');
  if (cap.hasCompact) available.push('Compact');
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
  if (cap.hasBrowserUse) bits.push('Browser* not Playwright install');
  if (cap.hasComputerUse) bits.push('Computer* not pyautogui');
  if (cap.hasWebSearch || cap.hasFetchUrl) bits.push('WebSearch/FetchURL when stale');
  if (cap.hasContext7) bits.push('Context7 for libs');
  if (cap.hasLeanRead) bits.push('RepoQuery before dumps');
  if (cap.hasAgent || cap.hasJob) bits.push('Agent/Job* not catalog swarm');
  if (cap.hasScript) bits.push('Script for bulk');
  if (cap.hasCompact) bits.push('Compact when bloated');
  if (cap.hasMemory) bits.push('Memory tool');
  bits.push('dedicated tools > Bash');
  bits.push('Write≠shell I/O');
  bits.push('no secret shell');
  // `explore→edit→check` already carries the verify step, and the stop sensor
  // raises "verify before done" at the moment it matters — keep this re-injected
  // checkpoint inside its length budget instead of repeating it.
  bits.push('explore→edit→check');
  bits.push('XP loop');
  return bits.join(' · ');
}
