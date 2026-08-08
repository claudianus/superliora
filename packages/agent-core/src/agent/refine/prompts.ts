/**
 * Planner prompts for the refine pipeline (ported from prime's
 * buildRefineSystemPrompt/buildRefineUserPrompt, adapted to this harness:
 * prompt/subagent ledger entries, memory via the Memory store, skills via
 * SKILL.md files).
 */

import type { HarnessScope, HarnessState } from './state';

export function buildRefineSystemPrompt(scope: HarnessScope): string {
  const scopeRule =
    scope === 'global'
      ? 'Scope: global. Only propose reusable, generalizable improvements.'
      : 'Scope: local. Prefer local, task-specific improvements.';
  return [
    'You are the harness refinement planner for a coding agent.',
    'Analyze the serialized trajectory and propose concrete harness improvements.',
    scopeRule,
    'Prefer small, reversible edits.',
    'Every edit must include evidence copied from the trajectory.',
    '',
    'Edit kinds:',
    '- prompt: durable behavioral notes injected into future context (conventions discovered, mistakes to avoid, workflow rules).',
    '- memory: long-term memory records (subject + content) stored in the Memory store.',
    '- skill: reusable SKILL.md playbooks (name, description, whenToUse, body).',
    '- subagent: reusable delegation specs (title, path, content) for recurring subagent tasks.',
    '',
    'Return JSON only, no prose, matching exactly:',
    '{',
    '  "summary": "short overall summary",',
    '  "edits": [',
    '    {',
    '      "kind": "prompt|memory|skill|subagent",',
    '      "operation": "create|update|delete",',
    '      "targetId": "existing id/name for update/delete; omit for create",',
    '      "expectedVersion": 1,',
    '      "title": "required for prompt/subagent",',
    '      "content": "required for prompt/subagent",',
    '      "path": "optional workspace path for subagent",',
    '      "subject": "required for memory",',
    '      "tags": ["optional", "memory", "tags"],',
    '      "name": "required for skill (kebab-case)",',
    '      "description": "required for skill",',
    '      "whenToUse": "optional for skill",',
    '      "body": "required for skill",',
    '      "evidence": "required: trajectory excerpt justifying the edit"',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Keep edits grounded in the trajectory; no speculation.',
    '- Subagent results may end with a [friction] block (deterministic stats: turns, tool calls, tool errors). High friction is strong evidence — prefer a skill or subagent-spec edit that would have prevented the repeated failure.',
    '- Conductor Job desk / inbox notices (failed Jobs, needs_user, verification misses) are trajectory evidence — prefer skills or prompt notes that would have prevented the same brief/verification failure.',
    '- When the trajectory shows tool failures followed by a working recovery, prefer kind=skill (concrete steps) over a vague prompt note.',
    '- User corrections and repeated preferences → prompt or memory; reusable procedures → skill.',
    '- Never propose edits that weaken verification, skip tests/gates, redefine success to hide failures, or teach the agent to claim done without evidence (reward-hacking).',
    '- For update/delete of prompt/subagent entries, include targetId and expectedVersion from the current state.',
    '- For update/delete of memory, targetId is the memory record id; for skill, the skill name.',
    '- Propose at most 8 edits, ordered by expected impact.',
    '- Return {"summary":"...","edits":[]} when the trajectory shows nothing worth persisting.',
  ].join('\n');
}

export function buildRefineUserPrompt(input: {
  readonly scope: HarnessScope;
  readonly state: HarnessState;
  readonly instructions?: string;
  readonly serializedTrajectory: string;
}): string {
  const lines = [
    `Scope: ${input.scope}`,
    '',
    'Current harness state (prompt/subagent entries with id + version):',
    '```json',
    JSON.stringify(
      {
        entries: input.state.entries.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          scope: entry.scope,
          version: entry.version,
          content: entry.content,
          path: entry.path,
        })),
      },
      null,
      2,
    ),
    '```',
    '',
  ];
  if (input.instructions !== undefined && input.instructions.trim().length > 0) {
    lines.push('Operator instructions:', input.instructions.trim(), '');
  }
  lines.push('Serialized trajectory:', '```text', input.serializedTrajectory, '```');
  return lines.join('\n');
}
