/**
 * LLM lesson gate + SKILL.md distill. Used by auto-skillify: only persist
 * reusable recoveries, inferred constraints, and non-obvious facts — never
 * generic retries or stack-trace restatements.
 */

import { z } from 'zod';

import type { Agent } from '../agent/index';
import { createCompactionProvider } from '../agent/compaction/full/full-provider';
import { LEARNING_LANES } from '../agent/learning-lanes';
import { sliceJsonObject } from '../agent/refine/plan';
import { serializeTrajectoryForRefine } from '../agent/refine/serialize';
import { SKILL_NAME_RE, commitProjectSkill } from '../tools/builtin/fleet/skill-create';
import { WRITING_QUALITY_GATE_MARKER } from '../tools/builtin/fleet/skill-writing-quality';
import type { ToolCallEvent } from './auto-skillify';
import { skillWhenToUse } from './types';

const LESSON_KINDS = [
  'nonobvious_fact',
  'inferred_constraint',
  'recovery_playbook',
  'user_correction',
] as const;

type LessonKind = (typeof LESSON_KINDS)[number];

const LessonGateSchema = z
  .object({
    hasLesson: z.boolean(),
    lessonKind: z.preprocess(
      (value) =>
        typeof value === 'string' && (LESSON_KINDS as readonly string[]).includes(value)
          ? value
          : undefined,
      z.enum(LESSON_KINDS).optional(),
    ),
    rationale: z.string(),
    focus: z.string().optional(),
  })
  .strict();

const DistilledSkillSchema = z
  .object({
    name: z.string().regex(SKILL_NAME_RE),
    description: z.string().min(1),
    whenToUse: z.string().min(1),
    triggers: z.array(z.string().min(1)).max(16),
    body: z.string().min(1),
    evidence: z.string().min(1),
    updateOf: z.string().optional(),
  })
  .strict();

type LessonGate = z.infer<typeof LessonGateSchema>;
type DistilledSkill = z.infer<typeof DistilledSkillSchema>;

export class SkillDistillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillDistillError';
  }
}

const GATE_SYSTEM_PROMPT = [
  'You are the lesson gate for a coding-agent skill distiller.',
  LEARNING_LANES,
  'A skill is a reusable playbook a FUTURE agent will SearchSkill and follow. Facts and preferences belong in Memory, not here.',
  'Answer hasLesson=true only when the trajectory contains at least one of:',
  '- nonobvious_fact: something a reader of AGENTS.md / the repo would not have known without this run',
  '- inferred_constraint: an environment, platform, or API quirk discovered by failing first',
  '- recovery_playbook: failed approaches AND the exact command/path that then worked',
  '- user_correction: the user steered away from a mistake that would otherwise recur',
  '',
  'hasLesson=false for: first-try success, generic timeout/retry with the same command, stack traces restated,',
  'one-off file edits, catalog workflows (git commit, generic test runner), or lessons already listed below.',
  '',
  'Return JSON only:',
  '{"hasLesson": boolean, "lessonKind": "nonobvious_fact|inferred_constraint|recovery_playbook|user_correction", "rationale": "one sentence", "focus": "when yes: what to distill"}',
].join('\n');

const DISTILL_SYSTEM_PROMPT = [
  'You write one SKILL.md playbook from a verified lesson in an agent trajectory.',
  'The skill must raise a future agent\'s efficiency and quality — not narrate this session.',
  '',
  'Rules:',
  '- Name: kebab-case, human meaning (windows-pnpm-e2e-spawn), never retry-<tool>-<error-slug>.',
  '- description AND whenToUse AND triggers: 3–12 English SearchSkill keywords (task, domain, error, tool).',
  '- body: numbered steps with the EXACT commands/paths that worked. Include "Done when …".',
  '- Steer by positive target behaviour: say what to DO, with the exact command/path/rule.',
  '  Fold cautions into one short line at most; a body that mostly says don\'t/never/avoid is rejected.',
  '- Generalize temp paths and commit SHAs. Keep repo-relative commands.',
  '- If an existing auto skill listed below is the same lesson, set updateOf to that name and improve it.',
  '- Do not invent steps that did not happen. Evidence must quote the trajectory.',
  '',
  'Self-check before returning (all must hold):',
  '- body contains a "Done when …" bound',
  '- body has ordered steps with at least one concrete command, path, or decision rule',
  '- description and whenToUse together carry 3+ distinct English trigger tokens',
  '- positive instructions outnumber don\'t/never/avoid statements',
  '',
  'Return JSON only:',
  '{"name":"kebab-name","description":"…","whenToUse":"…","triggers":["…"],"body":"markdown","evidence":"quote","updateOf":"optional-existing-name"}',
].join('\n');

export function parseLessonGate(text: string): LessonGate {
  const parsed = sliceJsonObject(text, (message) => new SkillDistillError(`Lesson gate returned ${message}`));
  const validated = LessonGateSchema.safeParse(parsed);
  if (!validated.success) {
    throw new SkillDistillError(
      `Lesson gate JSON failed validation: ${validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return validated.data;
}

export function parseDistilledSkill(text: string): DistilledSkill {
  const parsed = sliceJsonObject(text, (message) => new SkillDistillError(`Distill returned ${message}`));
  const validated = DistilledSkillSchema.safeParse(parsed);
  if (!validated.success) {
    throw new SkillDistillError(
      `Distill JSON failed validation: ${validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return validated.data;
}

export function formatWorkerEventsForDistill(events: readonly ToolCallEvent[]): string {
  return events
    .map((event) => {
      const status = event.success ? 'ok' : 'ERR';
      const parts = [
        `${event.toolName} ${status} retry=${String(event.retryCount)}`,
        event.inputSummary !== undefined && event.inputSummary.length > 0
          ? `input: ${event.inputSummary}`
          : undefined,
        event.error !== undefined && event.error.length > 0 ? `error: ${event.error}` : undefined,
        event.outputSummary !== undefined && event.outputSummary.length > 0
          ? `output: ${event.outputSummary}`
          : undefined,
      ].filter((part): part is string => part !== undefined);
      return parts.join('\n');
    })
    .join('\n---\n');
}

export function hasDistillSignal(events: readonly ToolCallEvent[]): boolean {
  return events.some((event) => event.retryCount > 0 && event.success);
}

function existingAutoSkillLines(agent: Agent): string {
  const skills = agent.skills?.registry.listInvocableSkills() ?? [];
  const local = skills.filter((skill) => skill.source === 'project' || skill.source === 'user');
  if (local.length === 0) return '(none)';
  return local
    .slice(0, 40)
    .map((skill) => {
      const when = skillWhenToUse(skill);
      return `- ${skill.name}: ${skill.description}${when.length > 0 ? ` | ${when}` : ''}`;
    })
    .join('\n');
}

async function generateJsonText(agent: Agent, system: string, user: string): Promise<string> {
  const provider = createCompactionProvider(
    { agent, compactionModelAlias: undefined },
    agent.context.tokenCount,
  );
  const result = await agent.generate(
    provider,
    system,
    [],
    [
      {
        role: 'user',
        content: [{ type: 'text', text: user }],
        toolCalls: [],
      },
    ],
  );
  return result.message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

async function distillLessonToSkill(
  agent: Agent,
  input: {
    readonly serializedTrajectory: string;
    readonly existingSkills: string;
    readonly focus?: string | undefined;
  },
): Promise<{ readonly writtenPath: string } | undefined> {
  const distillUser = [
    input.focus !== undefined && input.focus.trim().length > 0 ? `Focus: ${input.focus}` : undefined,
    '',
    'Existing local skills (updateOf if this is the same lesson):',
    input.existingSkills,
    '',
    'Trajectory:',
    '```text',
    input.serializedTrajectory,
    '```',
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');

  let distilled = parseDistilledSkill(await generateJsonText(agent, DISTILL_SYSTEM_PROMPT, distillUser));
  const name =
    distilled.updateOf !== undefined &&
    distilled.updateOf.length > 0 &&
    agent.skills?.registry.getSkill(distilled.updateOf) !== undefined
      ? distilled.updateOf
      : distilled.name;

  const commit = async (
    skill: DistilledSkill,
  ): Promise<{ readonly ok: boolean; readonly error?: string; readonly skippedIdentical?: boolean; readonly skillMdPath?: string }> =>
    commitProjectSkill(agent, {
      name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      triggers: skill.triggers,
      body: skill.body,
      origin: 'auto',
    });

  let committed = await commit(distilled);
  if (!committed.ok && committed.error?.includes(WRITING_QUALITY_GATE_MARKER) === true) {
    // One feedback retry: the gate rejection text is exactly the rewrite brief.
    distilled = parseDistilledSkill(
      await generateJsonText(
        agent,
        DISTILL_SYSTEM_PROMPT,
        `${distillUser}\n\nYour previous draft was rejected:\n${committed.error}\n\nRewrite the skill so it passes. Return JSON only, same shape.`,
      ),
    );
    committed = await commit(distilled);
  }
  if (!committed.ok) {
    throw new SkillDistillError(committed.error ?? 'skill commit failed');
  }
  if (committed.skippedIdentical) return undefined;
  return { writtenPath: committed.skillMdPath! };
}

export async function runLessonDistill(
  agent: Agent,
  serializedTrajectory: string,
): Promise<{ readonly writtenPath: string } | undefined> {
  const existingSkills = existingAutoSkillLines(agent);
  const gateUser = [
    'Existing local skills (treat as already captured):',
    existingSkills,
    '',
    'Serialized trajectory:',
    '```text',
    serializedTrajectory,
    '```',
  ].join('\n');
  const gate = parseLessonGate(await generateJsonText(agent, GATE_SYSTEM_PROMPT, gateUser));
  if (!gate.hasLesson) return undefined;
  return distillLessonToSkill(agent, {
    serializedTrajectory,
    existingSkills,
    focus: gate.focus ?? gate.rationale,
  });
}

export function serializeHistoryForDistill(agent: Agent, maxChars: number = 40_000): string {
  return serializeTrajectoryForRefine(agent.context.history, maxChars);
}
