import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_PROFILES,
  loadAgentProfilesFromDir,
  loadAgentProfilesFromSources,
  resolveAgentProfiles,
  type SystemPromptContext,
} from '../../src/profile';
import { SessionSkillRegistry, type SkillDefinition } from '../../src/skill';

let workDir: string;

const promptContext: SystemPromptContext = {
  osEnv: {
    osKind: 'macOS',
    osArch: 'arm64',
    osVersion: '0',
    shellName: 'bash',
    shellPath: '/bin/bash',
  },
  cwd: '/workspace',
  now: '2026-05-09T00:00:00.000Z',
  cwdListing: 'README.md',
  agentsMd: 'Project instructions.',
  skills: 'Available test skills.',
};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'kimi-agent-profile-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('agent profile loader', () => {
  it('loads YAML profiles, inherits templates, and renders with runtime context', async () => {
    const systemPath = await write(
      'system.md',
      [
        'os={{ KIMI_OS }}',
        'cwd={{ KIMI_WORK_DIR }}',
        'listing={{ KIMI_WORK_DIR_LS }}',
        'agents={{ KIMI_AGENTS_MD }}',
        'skills={{ KIMI_SKILLS }}',
        'parent={{ parentOnly }}',
        'child={{ childOnly }}',
        'role={{ ROLE_ADDITIONAL }}',
        '{% if KIMI_OS == "macOS" %}nunjucks-ok{% endif %}',
      ].join('\n'),
    );
    await write(
      'agent.yaml',
      `
name: agent
description: Parent agent
systemPromptPath: ./${fileName(systemPath)}
promptVars:
  parentOnly: parent-value
  roleAdditional: parent-role
tools:
  - Read
subagents:
  shared:
    description: Shared parent subagent
  coder:
    description: Coder child subagent
`,
    );
    await write(
      'coder.yaml',
      `
extends: agent
name: coder
promptVars:
  childOnly: child-value
  roleAdditional: child-role
tools:
  - Bash
  - Skill
`,
    );
    await write(
      'shared.yaml',
      `
name: shared
systemPromptTemplate: shared prompt
tools:
  - Read
`,
    );

    const profiles = await loadAgentProfilesFromDir([
      join(workDir, 'agent.yaml'),
      join(workDir, 'coder.yaml'),
      join(workDir, 'shared.yaml'),
      join(workDir, 'missing.yaml'),
    ]);
    const coderPrompt = profiles['coder']?.systemPrompt(promptContext);

    expect(profiles['coder']?.description).toBe('Coder child subagent');
    expect(profiles['coder']?.tools).toEqual(['Bash', 'Skill']);
    expect(profiles['agent']?.subagents?.['shared']).toBe(profiles['shared']);
    expect(profiles['agent']?.subagents?.['coder']).toBe(profiles['coder']);
    expect(profiles['coder']?.subagents).toBeUndefined();
    expect(profiles['shared']?.description).toBe('Shared parent subagent');
    expect(coderPrompt).toContain('os=macOS');
    expect(coderPrompt).toContain('cwd=/workspace');
    expect(coderPrompt).toContain('listing=README.md');
    expect(coderPrompt).toContain('agents=Project instructions.');
    expect(coderPrompt).toContain('skills=Available test skills.');
    expect(coderPrompt).toContain('parent=parent-value');
    expect(coderPrompt).toContain('child=child-value');
    expect(coderPrompt).toContain('role=child-role');
    expect(coderPrompt).toContain('nunjucks-ok');
    expect(coderPrompt).not.toContain('{{ ROLE_ADDITIONAL }}');
  });

  it('renders canonical SUPERLIORA_* vars and concatenates roleAdditionalAppend', () => {
    const template =
      'os={{ SUPERLIORA_OS }} cwd={{ SUPERLIORA_WORK_DIR }} role={{ ROLE_ADDITIONAL }}';
    const profiles = resolveAgentProfiles([
      {
        name: 'base',
        systemPromptTemplate: template,
        promptVars: { roleAdditional: 'base-role' },
      },
      {
        name: 'child',
        extends: 'base',
        systemPromptTemplate: template,
        promptVars: { roleAdditionalAppend: 'child-extra' },
      },
      {
        name: 'replacer',
        extends: 'base',
        systemPromptTemplate: template,
        promptVars: { roleAdditional: 'own-role' },
      },
    ]);

    const childPrompt = profiles['child']?.systemPrompt(promptContext);
    expect(childPrompt).toContain('os=macOS');
    expect(childPrompt).toContain('cwd=/workspace');
    expect(childPrompt).toContain('role=base-role\n\nchild-extra');
    // roleAdditional keeps replace semantics; only roleAdditionalAppend chains.
    expect(profiles['replacer']?.systemPrompt(promptContext)).toContain('role=own-role');
  });

  it('reports invalid profile graphs without relying on loader internals', () => {
    expect(() =>
      resolveAgentProfiles([
        {
          name: 'agent',
          subagents: {
            missing: { description: 'Missing subagent' },
          },
        },
      ]),
    ).toThrow(/declares subagent "missing"/);

    expect(() => resolveAgentProfiles([{ name: 'agent' }, { name: 'agent' }])).toThrow(
      /Duplicate agent profile name: "agent"/,
    );

    expect(() =>
      resolveAgentProfiles([
        { name: 'agent', extends: 'coder' },
        { name: 'coder', extends: 'agent' },
      ]),
    ).toThrow(/agent -> coder -> agent/);
  });

  it('fails loudly when an embedded system prompt source is missing', () => {
    expect(() =>
      loadAgentProfilesFromSources(['profile/default/agent.yaml'], {
        'profile/default/agent.yaml': 'name: agent\nsystemPromptPath: ./missing.md\n',
      }),
    ).toThrow(/Embedded agent profile source missing: profile\/default\/missing\.md/);
  });
});

describe('default agent profiles', () => {
  it('links bundled subagents and keeps role-specific tool sets observable', () => {
    expect(DEFAULT_AGENT_PROFILES['agent']?.subagents?.['coder']).toBe(
      DEFAULT_AGENT_PROFILES['coder'],
    );
    expect(DEFAULT_AGENT_PROFILES['agent']?.subagents?.['explore']).toBe(
      DEFAULT_AGENT_PROFILES['explore'],
    );
    expect(DEFAULT_AGENT_PROFILES['agent']?.subagents?.['plan']).toBe(
      DEFAULT_AGENT_PROFILES['plan'],
    );

    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toEqual(
      expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Fleet']),
    );
    expect(DEFAULT_AGENT_PROFILES['superliora-full']?.tools).toEqual(
      expect.arrayContaining([
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Agent',
        'Fleet',
        'JobCreate',
        'CreateGoal',
        'UpdateGoal',
        'Skill',
        'Memory',
        'WebSearch',
        'FetchURL',
        'TaskList',
        'TaskOutput',
        'TaskStop',
        'EnterPlanMode',
        'NextPhase',
        'ExitPlanMode',
        'mcp__*',
      ]),
    );
    expect(DEFAULT_AGENT_PROFILES['coder']?.tools).toEqual(
      expect.arrayContaining([
        'Read',
        'Write',
        'Edit',
        'ApplyPatch',
        'Bash',
        'Memory',
        'WebSearch',
        'FetchURL',
        'BrowserObserve',
        'VerifySurface',
        'TodoList',
      ]),
    );
    expect(DEFAULT_AGENT_PROFILES['explore']?.tools).toEqual(
      expect.arrayContaining([
        'Read',
        'Grep',
        'Glob',
        'RepoQuery',
        'WebSearch',
        'DeepResearch',
        'FetchURL',
        'TodoList',
      ]),
    );
    expect(DEFAULT_AGENT_PROFILES['plan']?.tools).toEqual(
      expect.arrayContaining([
        'Read',
        'Write',
        'Edit',
        'ApplyPatch',
        'Grep',
        'Glob',
        'RepoQuery',
        'WebSearch',
        'DeepResearch',
        'FetchURL',
        'TodoList',
      ]),
    );
    expect(DEFAULT_AGENT_PROFILES['explore']?.tools).not.toContain('Write');
    expect(DEFAULT_AGENT_PROFILES['explore']?.tools).not.toContain('ApplyPatch');
    for (const name of ['explore', 'plan'] as const) {
      const tools = DEFAULT_AGENT_PROFILES[name]?.tools ?? [];
      for (const legacy of ['LioraRead', 'LioraTree', 'LioraSymbol', 'LioraCallgraph']) {
        expect(tools).not.toContain(legacy);
      }
    }
  });

  it('bundled subagent profiles share the base preamble via roleAdditionalAppend', () => {
    const render = (name: string) =>
      DEFAULT_AGENT_PROFILES[name]?.systemPrompt({ ...promptContext, skills: '' }) ?? '';

    for (const name of ['coder', 'explore', 'plan']) {
      expect(render(name)).toContain('You are now running as a subagent.');
      expect(render(name)).toContain('create a live TodoList within your first 2 tool calls');
    }
    expect(render('explore')).toContain('Read-only codebase exploration specialist');
    expect(render('plan')).toContain('Read-only implementation planning specialist');
    expect(render('coder')).toContain('Execution cadence');

    // ultra-plan sets roleAdditional directly — replace semantics, no base leak.
    const ultra = render('ultra-plan');
    expect(ultra).toContain('Ultra Plan subagent');
    expect(ultra).not.toContain('You are now running as a subagent.');
  });

  it('renders stable skill runtime guidance for bundled prompts', () => {
    const skills = new SessionSkillRegistry();
    skills.register(skill('review', { whenToUse: 'When code review is requested.' }));
    skills.register({
      ...skill('nested-review', {
        isSubSkill: true,
        whenToUse: 'When nested review is requested.',
      }),
      path: '/skills/parent/nested-review/SKILL.md',
      dir: '/skills/parent/nested-review',
      content: 'Nested review body must not enter system prompt.',
    });
    skills.register(skill('private', { disableModelInvocation: true }));
    skills.register(skill('flow-only', { type: 'flow' }));

    const prompt = DEFAULT_AGENT_PROFILES['superliora-full']?.systemPrompt({
      ...promptContext,
      skills,
    });

    expect(prompt).toContain('# Skill Runtime');
    expect(prompt).toContain('Discover with SearchSkill');
    // Anti-slop guidance has one canonical home (the writing-style section);
    // the skill-runtime block no longer repeats it.
    expect(prompt).toContain('Light inline pass by default');
    expect(prompt).toContain('AGENTS.md, tool policies, and verified repo facts override skill text');
    expect(prompt).not.toContain('- review:');
    expect(prompt).not.toContain('When to use: When code review is requested.');
    expect(prompt).not.toContain('- nested-review:');
    expect(prompt).not.toContain('Path: /skills/parent/nested-review/SKILL.md');
    expect(prompt).not.toContain('When to use: When nested review is requested.');
    expect(prompt).not.toContain('- private:');
    expect(prompt).not.toContain('flow-only');
    expect(prompt).not.toContain('body of review');
    expect(prompt).not.toContain('Nested review body must not enter system prompt.');
  });

  it('renders deprecated legacy-list skill prompt mode as search mode', () => {
    const skills = new SessionSkillRegistry();
    skills.register(skill('review', { whenToUse: 'When code review is requested.' }));

    const prompt = DEFAULT_AGENT_PROFILES['superliora-full']?.systemPrompt({
      ...promptContext,
      skills,
      skillPromptMode: 'legacy-list',
    });

    // legacy-list is deprecated: old configs keep parsing but render the
    // search-mode skill block.
    expect(prompt).toContain('# Skill Runtime');
    expect(prompt).not.toContain('Current available skills:');
  });

  it('renders the bundled default prompt from the current runtime context', () => {
    const first = DEFAULT_AGENT_PROFILES['superliora-full']?.systemPrompt({
      ...promptContext,
      cwd: '/workspace/one',
    });
    const second = DEFAULT_AGENT_PROFILES['superliora-full']?.systemPrompt({
      ...promptContext,
      cwd: '/workspace/two',
    });

    expect(first).toContain('You are SuperLiora CLI');
    expect(first).toContain('Skill Runtime');
    expect(first).toContain('## Research');
    expect(first).toContain('Context7Resolve');
    expect(first).toContain('WebSearch / FetchURL');
    expect(first).toContain('/workspace/one');
    expect(second).toContain('/workspace/two');
    expect(second).not.toContain('/workspace/one');
  });

  it('renders subagent research autonomy into bundled subagent prompts', () => {
    const coder = DEFAULT_AGENT_PROFILES['coder']?.systemPrompt(promptContext);
    const explore = DEFAULT_AGENT_PROFILES['explore']?.systemPrompt(promptContext);
    const plan = DEFAULT_AGENT_PROFILES['plan']?.systemPrompt(promptContext);

    for (const prompt of [coder, explore, plan]) {
      expect(prompt).toContain('Use WebSearch/FetchURL when needed unless the parent forbids internet use');
    }
  });

  it('renders the Conductor operating playbook into the conductor prompt', () => {
    const prompt = DEFAULT_AGENT_PROFILES['conductor']?.systemPrompt(promptContext);
    expect(prompt).toContain('# Conductor Operating Playbook');
    expect(prompt).toContain('Delegation-only');
    expect(prompt).toContain('intake → triage → route → ACK');
    // Per-state routing moved into the job desk injection; the static prompt
    // keeps the principles the desk cannot restate every turn.
    expect(prompt).toContain('Never wait on workers');
    expect(prompt).toContain('Job brief quality bar');
  });

  it('layers runtime persona role text over the profile playbook instead of replacing it', () => {
    const prompt = DEFAULT_AGENT_PROFILES['conductor']?.systemPrompt({
      ...promptContext,
      roleAdditional: '# Persona: Test\n\nTone: terse.',
    });
    expect(prompt).toContain('# Conductor Operating Playbook');
    expect(prompt).toContain('# Persona: Test');
    expect(prompt!.indexOf('# Conductor Operating Playbook')).toBeLessThan(
      prompt!.indexOf('# Persona: Test'),
    );
  });
});

async function write(fileName: string, content: string): Promise<string> {
  const filePath = join(workDir, fileName);
  await writeFile(filePath, content.trimStart(), 'utf-8');
  return filePath;
}

function fileName(filePath: string): string {
  return filePath.slice(workDir.length + 1);
}

function skill(name: string, metadata: SkillDefinition['metadata'] = {}): SkillDefinition {
  return {
    name,
    description: `desc for ${name}`,
    path: `/skills/${name}/SKILL.md`,
    dir: `/skills/${name}`,
    content: `body of ${name}`,
    metadata,
    source: 'user',
  };
}
