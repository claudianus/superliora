/**
 * Auto-skillify distill retry: a writing-for-agents quality gate rejection
 * must not waste the whole distill run — the gate text is an exact rewrite
 * brief, so the distiller gets exactly one feedback round.
 */

import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent/index';
import { runLessonDistill } from '../../src/skill/skill-distill';

function generateResult(text: string) {
  return {
    id: null,
    message: {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
      toolCalls: [],
    },
    usage: null,
    finishReason: null,
    rawFinishReason: null,
  };
}

function makeAgent(options: {
  readonly cwd: string;
  readonly generate: ReturnType<typeof vi.fn>;
}) {
  const provider: { withThinking: ReturnType<typeof vi.fn> } = {
    withThinking: vi.fn(() => provider),
  };
  const registry = {
    listInvocableSkills: vi.fn(() => []),
    getSkill: vi.fn(() => undefined),
    register: vi.fn(),
  };
  const agent = {
    type: 'main',
    config: {
      cwd: options.cwd,
      modelAlias: 'test-model',
      modelCapabilities: { max_context_tokens: 100_000 },
      provider,
      maxOutputSize: undefined,
    },
    context: {
      history: [
        { role: 'user', content: [{ type: 'text', text: 'fix the flaky test' }], toolCalls: [] },
      ],
      tokenCount: 1_000,
    },
    generate: options.generate,
    records: { logRecord: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn() },
    skills: { registry },
    kimiConfig: undefined,
    runtimeConfig: undefined,
  } as unknown as Agent;
  return { agent, registry };
}

const GATE_YES = JSON.stringify({
  hasLesson: true,
  lessonKind: 'recovery_playbook',
  rationale: 'Windows e2e spawn EPERM recovered via the test-local runner',
  focus: 'distill the test-local runner recovery',
});

const REJECTED_BODY = [
  "1. Don't run pnpm test directly.",
  '2. Never use bare vitest.',
  '3. Do not set TZ manually.',
  '4. Avoid the repo root.',
  '',
  'Done when the focused test exits 0.',
].join('\n');

const PASSING_BODY = [
  '1. Run `node scripts/test-local.mjs <path>` from the repo root.',
  '2. Keep the runner-provided TZ=UTC environment.',
  '',
  'Done when the focused test exits 0.',
].join('\n');

const META = {
  name: 'windows-e2e-retry-runbook',
  description: 'Windows e2e retry runbook for spawn EPERM failures',
  whenToUse: 'When Windows e2e spawn EPERM strikes during test runs',
  triggers: ['windows e2e', 'spawn EPERM', 'retry'],
  evidence: 'Bash failed with spawn EPERM; test-local exited 0',
};

describe('runLessonDistill gate feedback retry', () => {
  it('retries once with the gate rejection text and commits the rewrite', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'skill-distill-retry-'));
    try {
      mkdirSync(join(cwd, '.git'));
      const generate = vi
        .fn()
        .mockResolvedValueOnce(generateResult(GATE_YES))
        .mockResolvedValueOnce(generateResult(JSON.stringify({ ...META, body: REJECTED_BODY })))
        .mockResolvedValueOnce(generateResult(JSON.stringify({ ...META, body: PASSING_BODY })));
      const { agent } = makeAgent({ cwd, generate });

      const result = await runLessonDistill(agent, 'trajectory text');

      expect(result?.writtenPath).toContain('windows-e2e-retry-runbook');
      expect(generate).toHaveBeenCalledTimes(3);
      const retryMessages = generate.mock.calls[2]?.[3] as readonly {
        content: readonly { text: string }[];
      }[];
      expect(JSON.stringify(retryMessages)).toContain('writing-for-agents quality gate');
      const skillMd = join(cwd, '.agents', 'skills', 'auto', 'windows-e2e-retry-runbook', 'SKILL.md');
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, 'utf-8')).toContain('Done when the focused test exits 0');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('surfaces the gate failure when the rewrite is also rejected', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'skill-distill-retry-'));
    try {
      mkdirSync(join(cwd, '.git'));
      const generate = vi
        .fn()
        .mockResolvedValueOnce(generateResult(GATE_YES))
        .mockResolvedValueOnce(generateResult(JSON.stringify({ ...META, body: REJECTED_BODY })))
        .mockResolvedValueOnce(generateResult(JSON.stringify({ ...META, body: REJECTED_BODY })));
      const { agent } = makeAgent({ cwd, generate });

      await expect(runLessonDistill(agent, 'trajectory text')).rejects.toThrow(
        /writing-for-agents quality gate/,
      );
      expect(generate).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
