import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'pathe';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextMessage } from '../../src/agent/context/types';
import type { Agent } from '../../src/agent/index';
import {
  extractToolCallEventsFromHistory,
  runAutoSkillify,
} from '../../src/skill/auto-skillify-runtime';

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'auto-skillify-runtime-'));
  await fs.mkdir(path.join(workDir, '.git'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

function textTool(id: string, text: string, isError?: boolean): ContextMessage {
  return {
    role: 'tool',
    content: [{ type: 'text', text }],
    toolCalls: [],
    toolCallId: id,
    ...(isError === true ? { isError: true } : {}),
  };
}

describe('extractToolCallEventsFromHistory', () => {
  it('sets retryCount when a tool succeeds after consecutive failures', () => {
    const history: ContextMessage[] = [
      {
        role: 'assistant',
        content: [],
        toolCalls: [
          { type: 'function', id: 'c1', name: 'Bash', arguments: '{}' },
          { type: 'function', id: 'c2', name: 'Bash', arguments: '{}' },
          { type: 'function', id: 'c3', name: 'Bash', arguments: '{}' },
        ],
      },
      textTool('c1', 'timeout waiting for process', true),
      textTool('c2', 'timeout waiting for process', true),
      textTool('c3', 'ok\n'),
    ];

    const events = extractToolCallEventsFromHistory(history);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ toolName: 'Bash', success: false });
    expect(events[1]).toMatchObject({ toolName: 'Bash', success: false });
    expect(events[2]).toMatchObject({ toolName: 'Bash', success: true, retryCount: 2 });
  });
});

describe('runAutoSkillify', () => {
  it('writes and registers a skill from retry recovery in history', async () => {
    const register = vi.fn();
    const agent = {
      config: { cwd: workDir },
      skills: {
        registry: {
          listInvocableSkills: () => [],
          register,
        },
      },
      context: {
        history: [
          {
            role: 'assistant',
            content: [],
            toolCalls: [
              { type: 'function', id: 'a', name: 'Bash', arguments: '{}' },
              { type: 'function', id: 'b', name: 'Bash', arguments: '{}' },
            ],
          },
          textTool('a', 'ECONNRESET from remote', true),
          textTool('b', 'done'),
        ] satisfies ContextMessage[],
      },
      log: { warn: vi.fn(), info: vi.fn() },
    } as unknown as Agent;

    const result = await runAutoSkillify(agent);
    expect(result.written.length).toBeGreaterThan(0);
    const skillMd = result.written[0]!;
    expect(skillMd).toContain(`${path.sep}auto${path.sep}`);
    expect(await fs.readFile(skillMd, 'utf-8')).toContain('source: auto');
    expect(register).toHaveBeenCalled();
  });

  it('is a no-op when history has no recoveries', async () => {
    const agent = {
      config: { cwd: workDir },
      skills: { registry: { listInvocableSkills: () => [], register: vi.fn() } },
      context: {
        history: [
          {
            role: 'assistant',
            content: [],
            toolCalls: [{ type: 'function', id: 'a', name: 'Grep', arguments: '{}' }],
          },
          textTool('a', 'matches'),
        ] satisfies ContextMessage[],
      },
      log: { warn: vi.fn(), info: vi.fn() },
    } as unknown as Agent;

    const result = await runAutoSkillify(agent);
    expect(result.written).toEqual([]);
  });
});
