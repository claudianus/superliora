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

import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { parseSkillMetadataFromFile } from '../../../skill/parser';
import { toInputJsonSchema } from '../../support/input-schema';
import DESCRIPTION from './skill-create.md?raw';
import {
  assessSkillWritingQuality,
  formatSkillWritingQualityFailure,
} from './skill-writing-quality';

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const SkillCreateToolInputSchema = z
  .object({
    name: z
      .string()
      .regex(SKILL_NAME_RE)
      .describe('Kebab-case skill name (e.g. "retry-flaky-e2e"). Reusing an existing name updates that skill.'),
    description: z
      .string()
      .min(1)
      .describe('One-line summary shown in skill search results.'),
    whenToUse: z
      .string()
      .optional()
      .describe('Trigger conditions — when a future agent should load this skill.'),
    body: z
      .string()
      .min(1)
      .describe('Markdown instructions: when to apply, exact steps/commands, pitfalls to avoid.'),
  })
  .strict();

export type SkillCreateToolInput = z.infer<typeof SkillCreateToolInputSchema>;

export class SkillCreateTool implements BuiltinTool<SkillCreateToolInput> {
  readonly name = 'SkillCreate' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SkillCreateToolInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: SkillCreateToolInput): ToolExecution {
    const skillDir = path.join(autoSkillsRoot(this.agent.config.cwd), args.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    return {
      accesses: ToolAccesses.writeFile(skillMdPath),
      description: `Creating skill ${args.name}`,
      approvalRule: this.name,
      execute: async () => {
        const qualityIssues = assessSkillWritingQuality(args.body);
        if (qualityIssues.length > 0) {
          return {
            isError: true,
            output: formatSkillWritingQualityFailure(qualityIssues),
          };
        }

        const content = renderSkillMd(args);
        const existing = await readIfExists(skillMdPath);
        if (existing === content) {
          return { output: `Skill "${args.name}" already exists with identical content at ${skillMdPath}.` };
        }

        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(skillMdPath, content, 'utf-8');

        // Register with the live registry so the skill is searchable/invocable
        // immediately, not only after the next session scan.
        const registry = this.agent.skills?.registry;
        if (registry?.register !== undefined) {
          const parsed = await parseSkillMetadataFromFile({
            skillMdPath,
            skillDirName: args.name,
            source: 'project',
          });
          registry.register(parsed, { replace: true });
        }

        const verb = existing === undefined ? 'Created' : 'Updated';
        return {
          output: `${verb} skill "${args.name}" at ${skillMdPath}. It is now discoverable via SearchSkill and invocable via Skill("${args.name}").`,
        };
      },
    };
  }
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

export function renderSkillMd(input: SkillCreateToolInput): string {
  // JSON-quoted scalars are valid YAML and need no further escaping.
  const lines = [
    '---',
    `name: ${input.name}`,
    `description: ${JSON.stringify(input.description)}`,
  ];
  if (input.whenToUse !== undefined && input.whenToUse.trim().length > 0) {
    lines.push(`whenToUse: ${JSON.stringify(input.whenToUse)}`);
  }
  lines.push('type: prompt', 'source: auto', 'risk: low', '---', '', input.body.trim(), '');
  return lines.join('\n');
}
