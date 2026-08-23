/**
 * SkillCreateTool — the agent authors a reusable SKILL.md from its own
 * trajectory (continual-harness style CRUD for skills).
 *
 * The skill lands in `<projectRoot>/.agents/skills/auto/<name>/SKILL.md` —
 * the same `auto/` convention as auto-skillify — so it persists on disk,
 * stays user-reviewable in git, and is picked up by the scanner on the next
 * session. The tool also registers the parsed definition with the live
 * registry immediately, so SearchSkill → Skill sees it without a restart.
 */

import { existsSync, promises as fs } from 'node:fs';
import path from 'pathe';

import type { AgentEvent } from '@superliora/protocol';
import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { parseSkillMetadataFromFile } from '../../../skill/parser';
import { toInputJsonSchema } from '../../support/input-schema';
import { LEARNING_LANES } from '../../../agent/learning-lanes';
import DESCRIPTION from './skill-create.md?raw';
import {
  assessSkillWritingQuality,
  formatSkillWritingQualityFailure,
} from './skill-writing-quality';

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const SkillCreateToolInputSchema = z
  .object({
    name: z
      .string()
      .regex(SKILL_NAME_RE)
      .describe('Kebab-case skill name (e.g. "retry-flaky-e2e"). Reusing an existing name updates that skill.'),
    description: z
      .string()
      .min(1)
      .describe(
        'One-line summary for SearchSkill: what it does AND 3–12 English trigger keywords (task, domain, error, tool).',
      ),
    whenToUse: z
      .string()
      .min(1)
      .describe('When a future agent should load this skill — concrete situations and example task phrases.'),
    triggers: z
      .array(z.string().min(1))
      .max(16)
      .optional()
      .describe('Extra SearchSkill aliases (short English phrases). Optional.'),
    body: z
      .string()
      .min(1)
      .describe(
        'Markdown: numbered steps with exact commands/paths, a "Done when …" line, and pitfalls to avoid.',
      ),
  })
  .strict();

export type SkillCreateToolInput = z.infer<typeof SkillCreateToolInputSchema>;

export type SkillCommitOrigin = 'tool' | 'auto' | 'refine';

export interface CommitProjectSkillHost {
  readonly config: { readonly cwd: string };
  readonly skills: {
    readonly registry?: {
      register?(skill: Awaited<ReturnType<typeof parseSkillMetadataFromFile>>, options?: { readonly replace?: boolean }): void;
    };
  } | null;
  emitEvent?(event: AgentEvent): void;
}

export interface CommitProjectSkillInput {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly body: string;
  readonly triggers?: readonly string[] | undefined;
  readonly origin?: SkillCommitOrigin | undefined;
}

export type CommitProjectSkillResult =
  | {
      readonly ok: true;
      readonly skillMdPath: string;
      readonly verb: 'Created' | 'Updated';
      readonly skippedIdentical: boolean;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

export class SkillCreateTool implements BuiltinTool<SkillCreateToolInput> {
  readonly name = 'SkillCreate' as const;
  readonly description: string = `${DESCRIPTION.trim()}\n\n${LEARNING_LANES}`;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SkillCreateToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: SkillCreateToolInput): ToolExecution {
    const skillDir = path.join(autoSkillsRoot(this.agent.config.cwd), args.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    return {
      accesses: ToolAccesses.writeFile(skillMdPath),
      description: `Creating skill ${args.name}`,
      display: { kind: 'generic', summary: `SkillCreate: ${args.name}` },
      approvalRule: this.name,
      execute: async () => {
        const committed = await commitProjectSkill(this.agent, { ...args, origin: 'tool' });
        if (!committed.ok) {
          return { isError: true, output: committed.error };
        }
        if (committed.skippedIdentical) {
          return {
            output: `Skill "${args.name}" already exists with identical content at ${committed.skillMdPath}. Invoke with Skill("${args.name}").`,
          };
        }
        return {
          output: `${committed.verb} skill "${args.name}" at ${committed.skillMdPath}. Discoverable via SearchSkill and invocable now via Skill("${args.name}") (no restart).`,
        };
      },
    };
  }
}

/**
 * Shared write+register path for SkillCreate, auto-skillify distill, and Refine.
 * Live-registers so SearchSkill / Skill work in the same session.
 */
export async function commitProjectSkill(
  agent: CommitProjectSkillHost,
  input: CommitProjectSkillInput,
): Promise<CommitProjectSkillResult> {
  if (!SKILL_NAME_RE.test(input.name)) {
    return { ok: false, error: `Skill name "${input.name}" must be kebab-case (a-z, 0-9, hyphen).` };
  }
  const qualityIssues = assessSkillWritingQuality(input.body, {
    description: input.description,
    whenToUse: input.whenToUse,
  });
  if (qualityIssues.length > 0) {
    return { ok: false, error: formatSkillWritingQualityFailure(qualityIssues) };
  }

  const skillDir = path.join(autoSkillsRoot(agent.config.cwd), input.name);
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const content = renderSkillMd(input);
  const existing = await readIfExists(skillMdPath);
  if (existing === content) {
    return { ok: true, skillMdPath, verb: 'Updated', skippedIdentical: true };
  }

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillMdPath, content, 'utf-8');

  const registry = agent.skills?.registry;
  if (registry?.register !== undefined) {
    const parsed = await parseSkillMetadataFromFile({
      skillMdPath,
      skillDirName: input.name,
      source: 'project',
    });
    registry.register(parsed, { replace: true });
  }

  const verb = existing === undefined ? 'Created' : 'Updated';
  agent.emitEvent?.({
    type: 'skill.created',
    skillName: input.name,
    skillPath: skillMdPath,
    origin: input.origin ?? 'tool',
    updated: verb === 'Updated',
    description: input.description,
  });
  return { ok: true, skillMdPath, verb, skippedIdentical: false };
}

/** Sync mirror of the scanner's findProjectRoot (tool resolution is sync). */
export function autoSkillsRoot(workDir: string): string {
  let current = path.resolve(workDir);
  while (true) {
    if (existsSync(path.join(current, '.git'))) {
      return path.join(current, '.agents', 'skills', 'auto');
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.join(path.resolve(workDir), '.agents', 'skills', 'auto');
    }
    current = parent;
  }
}

export async function readIfExists(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf-8');
  } catch {
    return undefined;
  }
}

export function renderSkillMd(input: CommitProjectSkillInput): string {
  // JSON-quoted scalars are valid YAML and need no further escaping.
  const lines = [
    '---',
    `name: ${input.name}`,
    `description: ${JSON.stringify(input.description)}`,
    `whenToUse: ${JSON.stringify(input.whenToUse)}`,
  ];
  const triggers = (input.triggers ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (triggers.length > 0) {
    lines.push('triggers:');
    for (const trigger of triggers) {
      lines.push(`  - ${JSON.stringify(trigger)}`);
    }
  }
  lines.push('type: prompt', 'source: auto', 'risk: low', '---', '', input.body.trim(), '');
  return lines.join('\n');
}
