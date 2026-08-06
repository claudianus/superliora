import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'pathe';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent/index';
import {
  SkillCreateTool,
  SkillCreateToolInputSchema,
} from '../../src/tools/builtin/fleet/skill-create';

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'skill-create-'));
  // Project-root detection walks up to a `.git` marker.
  await fs.mkdir(path.join(workDir, '.git'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

function makeAgent(registry?: { register: ReturnType<typeof vi.fn> }): Agent {
  return {
    config: { cwd: workDir },
    skills: registry === undefined ? null : { registry },
  } as unknown as Agent;
}

const INPUT = {
  name: 'retry-flaky-e2e',
  description: 'Retry pattern for flaky e2e runs',
  whenToUse: 'When e2e tests fail intermittently',
  body: '# Retry flaky e2e\n\nRun the suite three times before failing.',
};

describe('SkillCreateTool', () => {
  it('writes SKILL.md under .agents/skills/auto and registers it live', async () => {
    const registry = { register: vi.fn() };
    const tool = new SkillCreateTool(makeAgent(registry));

    const result = await tool.resolveExecution(INPUT).execute();

    const skillMd = path.join(workDir, '.agents', 'skills', 'auto', 'retry-flaky-e2e', 'SKILL.md');
    const written = await fs.readFile(skillMd, 'utf-8');
    expect(written).toContain('name: retry-flaky-e2e');
    expect(written).toContain('description: "Retry pattern for flaky e2e runs"');
    expect(written).toContain('whenToUse: "When e2e tests fail intermittently"');
    expect(written).toContain(INPUT.body);
    expect(result.isError !== true).toBe(true);
    expect(result.output).toContain('Created skill "retry-flaky-e2e"');

    expect(registry.register).toHaveBeenCalledOnce();
    const [definition, options] = registry.register.mock.calls[0]!;
    expect(definition.name).toBe('retry-flaky-e2e');
    expect(definition.description).toBe('Retry pattern for flaky e2e runs');
    expect(options).toEqual({ replace: true });
  });

  it('updates an existing skill with the same name', async () => {
    const tool = new SkillCreateTool(makeAgent({ register: vi.fn() }));
    await tool.resolveExecution(INPUT).execute();
    const updated = await tool
      .resolveExecution({ ...INPUT, body: '# v2\n\nBetter steps.' })
      .execute();

    expect(updated.output).toContain('Updated skill "retry-flaky-e2e"');
    const skillMd = path.join(workDir, '.agents', 'skills', 'auto', 'retry-flaky-e2e', 'SKILL.md');
    expect(await fs.readFile(skillMd, 'utf-8')).toContain('# v2');
  });

  it('is idempotent when content is unchanged', async () => {
    const tool = new SkillCreateTool(makeAgent({ register: vi.fn() }));
    await tool.resolveExecution(INPUT).execute();
    const again = await tool.resolveExecution(INPUT).execute();
    expect(again.output).toMatch(/already exists with identical content/);
  });

  it('still writes the file when no skill registry is available', async () => {
    const tool = new SkillCreateTool(makeAgent(undefined));
    const result = await tool.resolveExecution(INPUT).execute();
    expect(result.isError !== true).toBe(true);
    const skillMd = path.join(workDir, '.agents', 'skills', 'auto', 'retry-flaky-e2e', 'SKILL.md');
    expect(await fs.readFile(skillMd, 'utf-8')).toContain(INPUT.body);
  });

  it('rejects names that are not kebab-case (path traversal guard)', () => {
    for (const bad of ['../escape', 'UPPER', 'has space', 'a/b', '-leading']) {
      expect(SkillCreateToolInputSchema.safeParse({ ...INPUT, name: bad }).success).toBe(false);
    }
    expect(SkillCreateToolInputSchema.safeParse(INPUT).success).toBe(true);
  });
});
