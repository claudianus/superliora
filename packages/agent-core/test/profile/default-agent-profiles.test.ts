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

describe('default agent profiles', () => {
  it('loads the bundled default system prompt from embedded sources', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext);

    expect(prompt).toContain('You are Kimi Code CLI');
    expect(prompt).toContain('Skill Runtime');
    expect(prompt).toContain('/workspace');
  });

  it('keeps static instructions before dynamic prompt context', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext) ?? '';

    expect(prompt.indexOf('Use this as your basic understanding of the project structure.')).toBeLessThan(
      prompt.indexOf('LISTING_SNAPSHOT'),
    );
    expect(prompt.indexOf('User instructions given directly in the conversation')).toBeLessThan(
      prompt.indexOf('AGENTS_MD_BODY'),
    );
    expect(prompt.indexOf('Discover skills with SearchSkill using concise English keywords')).toBeLessThan(
      prompt.indexOf('- test-skill: does things'),
    );
  });

  it('lists the goal tools on the agent profile but not on subagent profiles', () => {
    const agentTools = DEFAULT_AGENT_PROFILES['agent']?.tools ?? [];
    expect(agentTools).toEqual(expect.arrayContaining(['CreateGoal', 'GetGoal']));
    for (const name of ['coder', 'explore', 'plan']) {
      const tools = DEFAULT_AGENT_PROFILES[name]?.tools ?? [];
      expect(tools).not.toContain('CreateGoal');
      expect(tools).not.toContain('GetGoal');
    }
  });

  it('exposes Ultrawork orchestration tools on the root agent profile', () => {
    const agentTools = DEFAULT_AGENT_PROFILES['agent']?.tools ?? [];
    expect(agentTools).toEqual(
      expect.arrayContaining([
        'EnterPlanMode',
        'NextPhase',
        'ExitPlanMode',
        'CreateGoal',
        'UpdateGoal',
        'SearchExpert',
        'AgentSwarm',
        'UltraSwarm',
      ]),
    );
  });

  it('keeps the root skill runtime prompt aligned with exposed tools', () => {
    const agent = DEFAULT_AGENT_PROFILES['agent'];
    expect(agent?.tools).toEqual(expect.arrayContaining(['Skill', 'SearchSkill']));

    const prompt = agent?.systemPrompt(promptContext) ?? '';
    expect(prompt).toContain('Discover skills with SearchSkill using concise English keywords');
  });

  it('exposes KimiContext to coding profiles as the default compact code-context surface', () => {
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toContain('KimiContext');
    expect(DEFAULT_AGENT_PROFILES['coder']?.tools).toContain('KimiContext');
    expect(DEFAULT_AGENT_PROFILES['plan']?.tools).not.toContain('KimiContext');
  });

  it('exposes Kimi Recall only to writable coding profiles', () => {
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toContain('Memory');
    expect(DEFAULT_AGENT_PROFILES['coder']?.tools).toContain('Memory');
    expect(DEFAULT_AGENT_PROFILES['explore']?.tools).not.toContain('Memory');
    expect(DEFAULT_AGENT_PROFILES['plan']?.tools).not.toContain('Memory');
  });

  it('fails loudly when an embedded system prompt source is missing', () => {
    expect(() =>
      loadAgentProfilesFromSources(['profile/default/agent.yaml'], {
        'profile/default/agent.yaml': 'name: agent\nsystemPromptPath: ./missing.md\n',
      }),
    ).toThrow(/Embedded agent profile source missing: profile\/default\/missing\.md/);
  });

  it('omits the skill runtime section for subagent profiles that lack the Skill tool', () => {
    const agentPrompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext) ?? '';
    expect(agentPrompt).toContain('# Skill Runtime');
    expect(agentPrompt).toContain('- test-skill: does things');

    for (const name of ['coder', 'explore', 'plan']) {
      const tools = DEFAULT_AGENT_PROFILES[name]?.tools ?? [];
      expect(tools).not.toContain('Skill');
      const prompt = DEFAULT_AGENT_PROFILES[name]?.systemPrompt(promptContext) ?? '';
      expect(prompt).not.toContain('# Skill Runtime');
      expect(prompt).not.toContain('- test-skill: does things');
    }
  });

  it('renders the default quality bar for root and subagent profiles', () => {
    for (const name of ['agent', 'coder', 'explore', 'plan']) {
      const prompt = DEFAULT_AGENT_PROFILES[name]?.systemPrompt(promptContext) ?? '';
      expect(prompt).toContain('# Default Quality Bar');
      expect(prompt).toContain('High-quality work is the default');
      expect(prompt).toContain('complete, polished, practical result');
      expect(prompt).toContain('domain-appropriate and polished by default');
      expect(prompt).toContain('first runnable surface look intentionally designed');
      expect(prompt).toContain('verify the actual rendered output');
      expect(prompt).toContain('a missing optional automation package is not proof');
      expect(prompt).toContain('Do not inflate scope just to look premium');
    }
  });

  it('renders practical engineering principles for root and subagent profiles', () => {
    for (const name of ['agent', 'coder', 'explore', 'plan']) {
      const prompt = DEFAULT_AGENT_PROFILES[name]?.systemPrompt(promptContext) ?? '';
      expect(prompt).toContain('# Practical Engineering Principles');
      expect(prompt).toContain('what problem actually needs to be solved');
      expect(prompt).toContain('Delete or simplify before optimizing');
      expect(prompt).toContain('Automate only after the workflow is understood and stable');
      expect(prompt).toContain('Minimize dependencies, indirection, and configuration');
      expect(prompt).toContain('does this actually improve the outcome');
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
      expect(prompt).toContain('refuse a fixed set of well-known secret files'); // shared guard stays
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
      expect(prompt).toContain('run the focused test'); // preamble phrasing example
      expect(prompt).toContain('premature abstraction'); // MINIMAL-changes counterexample
    }
  });
});
