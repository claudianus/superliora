import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_PROFILES, loadAgentProfilesFromSources } from '../../src/profile';

const promptContext = {
  osEnv: {
    osKind: 'macOS',
    osArch: 'arm64',
    osVersion: '0',
    shellName: 'bash',
    shellPath: '/bin/bash',
  },
  cwd: '/workspace',
  now: '2026-05-09T00:00:00.000Z',
  cwdListing: 'LISTING_SNAPSHOT',
  agentsMd: 'AGENTS_MD_BODY',
  skills: '- test-skill: does things\n  Path: /skills/test/SKILL.md',
} as const;

/** Legacy Liora* lean-context tools — excluded from sovereign waist profiles. */
const LEGACY_LIORA_TOOLS = [
  'LioraRead',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraReview',
] as const;

/** Lean-context Liora* tools — excluded even from superliora-full (public aliases cover them). */
const LEGACY_LEAN_LIORA_TOOLS = [...LEGACY_LIORA_TOOLS] as const;

/** Compat aliases dropped from superliora-full when the preferred tool is already listed. */
const FULL_PROFILE_COMPAT_ALIASES = ['LioraReview'] as const;

/** Tools that must not appear on Core≤12 or default coding waist surfaces. */
const WAIST_EXCLUDED_TOOLS = [...LEGACY_LIORA_TOOLS] as const;

describe('default agent profiles', () => {
  it('loads the bundled default system prompt from embedded sources', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext);

    expect(prompt).toContain('You are SuperLiora CLI');
    expect(prompt).toContain('/workspace');
    // Shared system prompt is on every turn for every profile — keep static bulk bounded.
    // Dynamic cwd listing / AGENTS.md body are excluded from this size check via context stubs.
    expect(prompt!.length).toBeLessThan(16_000);
  });

  it('keeps the cached system prefix byte-stable across clock changes (no volatile KIMI_NOW)', () => {
    // The system prompt is the first prompt-cache block. A per-process timestamp
    // (KIMI_NOW) used to be interpolated here, which invalidated the system+tools
    // cache on every process start. Authoritative time now comes from the tail
    // <current_time> injector / GetCurrentTime tool, so the cached prefix must be
    // byte-identical no matter what `now` the context carries.
    const earlier = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext) ?? '';
    const later =
      DEFAULT_AGENT_PROFILES['agent']?.systemPrompt({
        ...promptContext,
        now: '2031-12-31T23:59:59.999Z',
      }) ?? '';

    expect(later).toBe(earlier);
    expect(earlier).not.toContain('2026-05-09T00:00:00.000Z');
    expect(later).not.toContain('2031-12-31T23:59:59.999Z');
  });

  it('keeps static instructions before dynamic prompt context', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext) ?? '';

    expect(prompt.indexOf('Before any tool call, emit a short preamble')).toBeLessThan(
      prompt.indexOf('LISTING_SNAPSHOT'),
    );
    expect(prompt.indexOf('In subdirectories, check for local `AGENTS.md`')).toBeLessThan(
      prompt.indexOf('AGENTS_MD_BODY'),
    );
  });

  it('prefers CreateGoal and compact repo search on the default agent profile', () => {
    const mainTools = DEFAULT_AGENT_PROFILES['agent']?.tools ?? [];
    expect(mainTools).toContain('CreateGoal');
    expect(mainTools).toContain('RepoQuery');
    expect(mainTools).toEqual(expect.arrayContaining(['Grep', 'Glob']));
    for (const legacy of LEGACY_LIORA_TOOLS) {
      expect(mainTools).not.toContain(legacy);
    }
    expect(mainTools).toContain('Fleet');
  });

  it('lists goal tools on the main agent and full profile, not on subagent profiles', () => {
    const fullTools = DEFAULT_AGENT_PROFILES['superliora-full']?.tools ?? [];
    const mainTools = DEFAULT_AGENT_PROFILES['agent']?.tools ?? [];
    expect(fullTools).toEqual(expect.arrayContaining(['CreateGoal', 'GetGoal', 'GetCurrentTime']));
    expect(fullTools).toContain('TaskGraph');
    expect(mainTools).toEqual(
      expect.arrayContaining([
        'CreateGoal',
        'GetGoal',
        'SetGoalBudget',
        'UpdateGoal',
        'TodoList',
        'EnterPlanMode',
        'ExitPlanMode',
        'Skill',
        'SearchSkill',
        'SearchTools',
        'Agent',
      ]),
    );
    for (const name of ['coder', 'explore', 'plan']) {
      const tools = DEFAULT_AGENT_PROFILES[name]?.tools ?? [];
      expect(tools).not.toContain('CreateGoal');
      expect(tools).not.toContain('GetGoal');
    }
  });

  it('exposes GetCurrentTime on explore for time-sensitive web research', () => {
    const exploreTools = DEFAULT_AGENT_PROFILES['explore']?.tools ?? [];
    expect(exploreTools).toEqual(
      expect.arrayContaining(['GetCurrentTime', 'WebSearch', 'DeepResearch']),
    );
  });

  it('exposes plan, goal and job orchestration tools on the full profile', () => {
    const fullTools = DEFAULT_AGENT_PROFILES['superliora-full']?.tools ?? [];
    expect(fullTools).toEqual(
      expect.arrayContaining([
        'EnterPlanMode',
        'NextPhase',
        'ExitPlanMode',
        'CreateGoal',
        'UpdateGoal',
        'SearchExpert',
        'Fleet',
        'JobCreate',
        'JobList',
        'mcp__*',
      ]),
    );
  });

  it('keeps the full profile skill runtime prompt aligned with exposed tools', () => {
    const full = DEFAULT_AGENT_PROFILES['superliora-full'];
    expect(full?.tools).toEqual(expect.arrayContaining(['Skill', 'SearchSkill', 'SearchTools']));

    const prompt = full?.systemPrompt(promptContext) ?? '';
    expect(prompt).toContain('Discover with SearchSkill');
  });

  it('exposes RepoQuery as the default compact exploration surface on coding profiles', () => {
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toContain('RepoQuery');
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toContain('ApplyPatch');
    // Loop19c: DeepResearch is edge (full/explore/plan); coder trades it for Browser*
    // under the ≤30 waist. Default agent keeps WebSearch+FetchURL.
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toContain('WebSearch');
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toContain('FetchURL');
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).not.toContain('DeepResearch');
    const coderToolsForExplore = DEFAULT_AGENT_PROFILES['coder']?.tools ?? [];
    expect(coderToolsForExplore).toContain('RepoQuery');
    expect(coderToolsForExplore).toContain('BrowserScreenshot');
    expect(coderToolsForExplore).not.toContain('DeepResearch');
    expect(coderToolsForExplore).toContain('ApplyPatch');
    expect(coderToolsForExplore).toEqual(expect.arrayContaining(['Grep', 'Glob']));
    const planToolsForExplore = DEFAULT_AGENT_PROFILES['plan']?.tools ?? [];
    expect(planToolsForExplore).toContain('RepoQuery');
    expect(planToolsForExplore).toContain('DeepResearch');
    expect(planToolsForExplore).toContain('ApplyPatch');
    expect(planToolsForExplore).toEqual(expect.arrayContaining(['Grep', 'Glob']));
    for (const tools of [coderToolsForExplore, planToolsForExplore]) {
      for (const legacy of LEGACY_LIORA_TOOLS) {
        expect(tools).not.toContain(legacy);
      }
    }
    const exploreTools = DEFAULT_AGENT_PROFILES['explore']?.tools ?? [];
    expect(exploreTools).toContain('RepoQuery');
    expect(exploreTools).toContain('DeepResearch');
    expect(exploreTools).toEqual(expect.arrayContaining(['Grep', 'Glob']));
    expect(exploreTools).not.toContain('ApplyPatch');
    for (const legacy of LEGACY_LIORA_TOOLS) {
      expect(exploreTools).not.toContain(legacy);
    }
    expect(DEFAULT_AGENT_PROFILES['ultra-plan']?.tools).toEqual(
      expect.arrayContaining(['WebSearch', 'DeepResearch']),
    );
    const fullTools = DEFAULT_AGENT_PROFILES['superliora-full']?.tools ?? [];
    expect(fullTools).toEqual(
      expect.arrayContaining(['ApplyPatch', 'RepoQuery', 'DeepResearch', 'Review']),
    );
    for (const legacy of LEGACY_LEAN_LIORA_TOOLS) {
      expect(fullTools).not.toContain(legacy);
    }
  });


  it('defines conductor meta-orchestrator profile with lifecycle + Job tools under ≤30', () => {
    const tools = DEFAULT_AGENT_PROFILES['conductor']?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.length).toBeLessThanOrEqual(30);
    for (const name of [
      'EnterPlanMode',
      'ExitPlanMode',
      'GetGoal',
      'JobCreate',
      'JobList',
      'MergeJob',
      'JobResume',
      'JobInbox',
    ] as const) {
      expect(tools).toContain(name);
    }
    // `/goal` is session-API → Goal Desk; keep CreateGoal/UpdateGoal off Conductor.
    expect(tools).not.toContain('CreateGoal');
    expect(tools).not.toContain('UpdateGoal');
    // Plan phases run inside a plan worker, never on this lane
    expect(tools).not.toContain('NextPhase');
    expect(tools).not.toContain('RecordInterviewFinding');
    // V1-1: spawn/wait surfaces are guard-rejected and stay off the whitelist
    expect(tools).not.toContain('Agent');
    expect(tools).not.toContain('Fleet');
    expect(tools).not.toContain('RunProjectChecks');
  });

  it('defines the core waist profile with exactly 12 SSOT tools', () => {
    const coreTools = DEFAULT_AGENT_PROFILES['core']?.tools ?? [];
    expect(coreTools).toHaveLength(12);
    expect(coreTools).toEqual([
      'Read',
      'Edit',
      'ApplyPatch',
      'Write',
      'Grep',
      'Glob',
      'Bash',
      'RepoQuery',
      'TodoList',
      'AskUserQuestion',
      'RunProjectChecks',
      'WebSearch',
    ]);
    expect(coreTools).toEqual(expect.arrayContaining(['ApplyPatch', 'RepoQuery']));
    for (const excluded of WAIST_EXCLUDED_TOOLS) {
      expect(coreTools).not.toContain(excluded);
    }
  });

  it('keeps default agent waist ≤30 and moves Expand/Context7/media/expert/DeepResearch edges to full', () => {
    const agentTools = DEFAULT_AGENT_PROFILES['agent']?.tools ?? [];
    expect(agentTools.length).toBeLessThanOrEqual(30);
    // Conductor reform: RecordInterviewFinding on agent; Review on full — stay ≤30.
    // SkillCreate (continual-harness skill authoring) fills the last headroom slot.
    expect(agentTools).toHaveLength(30);
    expect(agentTools).toContain('RecordInterviewFinding');
    for (const edge of [
      'Expand',
      'Memory',
      'GetCurrentTime',
      'TaskGraph',
      'SearchExpert',
      'Context7Resolve',
      'Context7Docs',
      'ReadMediaFile',
      'DeepResearch',
    ] as const) {
      expect(agentTools).not.toContain(edge);
    }
    // Edges remain on full / specialist profiles.
    const fullTools = DEFAULT_AGENT_PROFILES['superliora-full']?.tools ?? [];
    expect(fullTools).toEqual(
      expect.arrayContaining([
        'Expand',
        'Memory',
        'GetCurrentTime',
        'TaskGraph',
        'SearchExpert',
        'Context7Resolve',
        'Context7Docs',
        'ReadMediaFile',
        'DeepResearch',
      ]),
    );
    const coderTools = DEFAULT_AGENT_PROFILES['coder']?.tools ?? [];
    expect(coderTools).toContain('Expand');
    for (const legacy of LEGACY_LEAN_LIORA_TOOLS) {
      expect(fullTools).not.toContain(legacy);
    }
    for (const alias of FULL_PROFILE_COMPAT_ALIASES) {
      expect(fullTools).not.toContain(alias);
    }
  });

  it('keeps Review on coder/full; agent prefers RecordInterviewFinding; VisualDiff/media Extended', () => {
    // Default agent waist: RecordInterviewFinding over Review; Review on full/coder.
    const agentTools = DEFAULT_AGENT_PROFILES['agent']?.tools ?? [];
    expect(agentTools).toContain('RecordInterviewFinding');
    expect(agentTools).not.toContain('Review');
    expect(agentTools).not.toContain('LioraReview');
    expect(agentTools).not.toContain('VisualDiff');
    expect(agentTools).not.toContain('GenerateImage');
    expect(agentTools).not.toContain('GenerateVideo');
    expect(agentTools).not.toContain('VerifySurface');
    expect(agentTools).not.toContain('mcp__*');

    const coderTools = DEFAULT_AGENT_PROFILES['coder']?.tools ?? [];
    expect(coderTools).toContain('Review');
    expect(coderTools).toContain('VisualDiff');
    expect(coderTools).toContain('VerifySurface');
    expect(coderTools).toContain('BrowserScreenshot');
    expect(coderTools).toContain('BrowserAct');
    expect(coderTools).not.toContain('DeepResearch');
    expect(coderTools).not.toContain('SkillCreate');
    expect(coderTools.length).toBeLessThanOrEqual(30);
    expect(coderTools).not.toContain('LioraReview');

    const goalDriverTools = DEFAULT_AGENT_PROFILES['goal-driver']?.tools ?? [];
    expect(goalDriverTools).toContain('BrowserScreenshot');
    expect(goalDriverTools).toContain('VerifySurface');
    expect(goalDriverTools).toContain('GetGoal');
    expect(goalDriverTools).toContain('UpdateGoal');
    expect(goalDriverTools.length).toBeLessThanOrEqual(30);

    const planTools = DEFAULT_AGENT_PROFILES['plan']?.tools ?? [];
    expect(planTools).toContain('Review');
    expect(planTools).not.toContain('VisualDiff');
    expect(planTools).not.toContain('LioraReview');

    const fullTools = DEFAULT_AGENT_PROFILES['superliora-full']?.tools ?? [];
    expect(fullTools).toContain('Review');
    expect(fullTools).not.toContain('LioraReview');
    expect(fullTools).toContain('VisualDiff');
    expect(fullTools).toContain('GenerateImage');
    expect(fullTools).toContain('GenerateVideo');
    expect(fullTools).toContain('VerifySurface');
    expect(fullTools).toContain('mcp__*');
    for (const alias of FULL_PROFILE_COMPAT_ALIASES) {
      expect(fullTools).not.toContain(alias);
    }
    // Read-only explore stays lean — no review/visual surface.
    const exploreTools = DEFAULT_AGENT_PROFILES['explore']?.tools ?? [];
    expect(exploreTools).not.toContain('Review');
    expect(exploreTools).not.toContain('LioraReview');
    expect(exploreTools).not.toContain('VisualDiff');
  });

  it('exposes Liora Memory only to writable coding profiles', () => {
    expect(DEFAULT_AGENT_PROFILES['coder']?.tools).toContain('Memory');
    expect(DEFAULT_AGENT_PROFILES['superliora-full']?.tools).toContain('Memory');
    expect(DEFAULT_AGENT_PROFILES['explore']?.tools).not.toContain('Memory');
    expect(DEFAULT_AGENT_PROFILES['plan']?.tools).not.toContain('Memory');
  });


  it('exposes SearchTools inventory on default coding and plan profiles', () => {
    for (const name of ['agent', 'coder', 'explore', 'plan', 'superliora-full', 'ultra-plan']) {
      const tools = DEFAULT_AGENT_PROFILES[name]?.tools ?? [];
      expect(tools, name).toContain('SearchTools');
    }
  });

  it('fails loudly when an embedded system prompt source is missing', () => {
    expect(() =>
      loadAgentProfilesFromSources(['profile/default/agent.yaml'], {
        'profile/default/agent.yaml': 'name: agent\nsystemPromptPath: ./missing.md\n',
      }),
    ).toThrow(/Embedded agent profile source missing: profile\/default\/missing\.md/);
  });

  it('includes skill tools for subagent profiles used by delegated experts', () => {
    for (const name of ['coder', 'explore', 'plan']) {
      const tools = DEFAULT_AGENT_PROFILES[name]?.tools ?? [];
      expect(tools).toContain('SearchSkill');
      expect(tools).toContain('SearchTools');
      expect(tools).toContain('Skill');
    }
  });

  it('renders the default quality bar for root and subagent profiles', () => {
    for (const name of ['agent', 'coder', 'explore', 'plan']) {
      const prompt = DEFAULT_AGENT_PROFILES[name]?.systemPrompt(promptContext) ?? '';
      expect(prompt).toContain('# Default Quality Bar');
      expect(prompt).toContain('High-quality work is the default');
      expect(prompt).toContain('complete, polished, practical result');
      expect(prompt).toContain('domain-appropriate and polished by default');
      expect(prompt).toContain('first runnable surface looks intentionally designed');
      expect(prompt).toContain('verify the actual rendered output');
      expect(prompt).toContain('missing optional automation packages do not prove');
      expect(prompt).toContain('Do not inflate scope just to look premium');
    }
  });

  it('renders practical engineering principles for root and subagent profiles', () => {
    for (const name of ['agent', 'coder', 'explore', 'plan']) {
      const prompt = DEFAULT_AGENT_PROFILES[name]?.systemPrompt(promptContext) ?? '';
      expect(prompt).toContain('# Practical Engineering Principles');
      expect(prompt).toContain('what problem actually needs solving');
      expect(prompt).toContain('Delete or simplify before optimizing');
      expect(prompt).toContain('Automate only after the workflow is understood and stable');
      expect(prompt).toContain('Minimize dependencies, indirection, and configuration');
      expect(prompt).toContain('does this actually improve the outcome');
      expect(prompt).toContain('# Execution Loop');
      expect(prompt).toContain('One verifiable increment per batch');
    }
  });

  it('keeps optional-tool guidance out of the shared system prompt entirely', () => {
    // Tool-coupled guidance now lives in each tool's own description, which the schema
    // layer ships ONLY when the tool is registered — that is the availability gate, for
    // free. So the shared system.md must not name optional tools at all (no per-tool
    // {% if %} reconstruction of availability). This holds for the root `agent` too, not
    // just subagents. The cross-tool secret-file guard — built on the always-present
    // Read/Grep/Glob — stays shared.
    for (const name of ['agent', 'coder', 'explore', 'plan']) {
      const prompt = DEFAULT_AGENT_PROFILES[name]?.systemPrompt(promptContext) ?? '';
      expect(prompt).not.toContain('Launch multiple explore agents concurrently'); // Agent → agent.md + explore whenToUse
      expect(prompt).not.toContain('long-running shell commands as background tasks'); // background → bash.md
      expect(prompt).not.toContain('maintain a `TodoList`'); // TodoList → todo-list.md
      expect(prompt).not.toContain('prefer entering plan mode first'); // EnterPlanMode → enter-plan-mode.md
      expect(prompt).not.toContain('call `TaskList` to re-enumerate'); // compaction recovery → task-list.md
      // The dedicated-tool routing must name only universally-present tools (Read/Glob/Grep).
      // Write/Edit/Bash are absent from read-only profiles (plan has no Bash/Write/Edit;
      // explore no Write/Edit), so naming them in the shared routing sentence would dangle —
      // that routing lives in bash.md (echo>file→Write, sed→Edit, etc.), which ships with Bash.
      expect(prompt).not.toContain('e.g., `Write`, `Bash`');
      expect(prompt).not.toContain('The Bash tool executes');
      expect(prompt).not.toContain('get it from the `Bash` tool');
      expect(prompt).not.toContain('`Write` / `Edit` to change files');
      expect(prompt).not.toContain('Keep `Bash` for genuine shell work');
      expect(prompt).toContain('`Glob` to find files by name'); // universal routing stays
      expect(prompt).toContain('well-known secret files'); // shared guard stays
      expect(prompt).toContain('If your active profile is read-only, stay read-only');
    }
  });

  it('renders blast-radius and concrete-example guidance for root and subagents alike', () => {
    // These additions live in shared, ungated sections, so the root agent AND every
    // subagent that renders the coding guidelines must carry them verbatim.
    for (const name of ['agent', 'coder', 'explore', 'plan']) {
      const prompt = DEFAULT_AGENT_PROFILES[name]?.systemPrompt(promptContext) ?? '';
      // Reversibility / blast-radius principle generalized beyond the git rule.
      expect(prompt).toContain('reversibility and blast radius');
      expect(prompt).toContain('A one-time approval covers that one action');
      // The "do local work freely" clause is role-scoped: read-only subagents (explore/plan)
      // render this same paragraph, so it must not tell them editing files is free.
      expect(prompt).toContain('Local, reversible work your role permits');
      // Concrete one-line examples anchoring high-frequency abstract rules.
      expect(prompt).toContain('locate the method in the code'); // ambiguous instruction -> edit code, not echo text
      expect(prompt).toContain('patch the failing path'); // preamble phrasing example
      expect(prompt).toContain('premature abstraction'); // MINIMAL-changes counterexample
    }
  });
});
