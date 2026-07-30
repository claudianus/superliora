import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadPluginAgent, resolvePluginAgentType } from '../../src/plugin/agents';

const tempDirs: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('plugin agent frontmatter', () => {
  it('parses Claude frontmatter fields and resolves bare names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'plugin-agent-'));
    tempDirs.push(root);
    const agentPath = path.join(root, 'reviewer.md');
    await writeFile(
      agentPath,
      `---
name: reviewer
description: Reviews PRs
model: fast
maxTurns: 8
tools: Read, Grep
disallowedTools: Bash
skills: code-review
background: true
isolation: worktree
---
Be thorough.
`,
      'utf8',
    );

    const def = await loadPluginAgent({
      pluginId: 'demo',
      agentPath,
      fallbackName: 'reviewer',
    });
    expect(def).toMatchObject({
      profileName: 'demo:reviewer',
      model: 'fast',
      maxTurns: 8,
      skills: ['code-review'],
      background: true,
      isolation: 'worktree',
    });
    expect(def?.profile.tools).toEqual(['Read', 'Grep']);

    expect(resolvePluginAgentType('reviewer', [def!])).toBe('demo:reviewer');
    expect(resolvePluginAgentType('demo:reviewer', [def!])).toBe('demo:reviewer');
  });
});
