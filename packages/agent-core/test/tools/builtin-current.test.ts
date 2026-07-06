/**
 * Current builtin tool smoke coverage.
 *
 * This complements focused tool tests by ensuring every current builtin
 * has at least one schema assertion and one execution/error-path assertion.
 */

import { Readable, type Writable } from 'node:stream';

import type { Kaos, KaosProcess } from '@superliora/kaos';
import type { WorkGraph, TeamPlan } from '@superliora/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type { SwarmMode } from '../../src/agent/swarm';
import { FLAG_DEFINITIONS, FlagResolver } from '../../src/flags';
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type QueuedSubagentRunResult,
  type QueuedSubagentTask,
  type SessionSubagentHost,
} from '../../src/session/subagent-host';
import { SessionSkillRegistry } from '../../src/skill';
import { TaskListInputSchema } from '../../src/tools/background/task-list';
import { TaskOutputInputSchema } from '../../src/tools/background/task-output';
import { TaskStopInputSchema } from '../../src/tools/background/task-stop';
import { AgentTool, AgentToolInputSchema } from '../../src/tools/builtin/collaboration/agent';
import {
  AskUserQuestionInputSchema,
  AskUserQuestionTool,
} from '../../src/tools/builtin/collaboration/ask-user';
import {
  SearchExpertInputSchema,
  SearchExpertTool,
} from '../../src/tools/builtin/collaboration/search-expert';
import {
  SearchSkillInputSchema,
  SearchSkillTool,
} from '../../src/tools/builtin/collaboration/search-skill';
import { SkillTool, SkillToolInputSchema } from '../../src/tools/builtin/collaboration/skill-tool';
import { EditInputSchema, EditTool } from '../../src/tools/builtin/file/edit';
import { GlobInputSchema, GlobTool } from '../../src/tools/builtin/file/glob';
import { GrepInputSchema, GrepTool } from '../../src/tools/builtin/file/grep';
import { ReadInputSchema, ReadTool } from '../../src/tools/builtin/file/read';
import { WriteInputSchema, WriteTool } from '../../src/tools/builtin/file/write';
import { BashInputSchema, BashTool } from '../../src/tools/builtin/shell/bash';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';
import { createFakeKaos } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';
import { createBackgroundManager } from '../agent/background/helpers';
import {
  AgentSwarmTool,
  AgentSwarmToolInputSchema,
} from '../../src/tools/builtin/collaboration/agent-swarm';
import {
  UltraSwarmTool,
  UltraSwarmToolInputSchema,
} from '../../src/tools/builtin/collaboration/ultra-swarm';
import { globalUltraSwarmOrchestrator } from '../../src/expert-agents/orchestrator';
import { SwarmChannelTool } from '../../src/tools/builtin/collaboration/swarm-channel';
import { createUltraSwarmRunContext } from '../../src/agent/ultra-swarm-run';
import { initSwarmRunBus, renderSwarmBusDigest } from '../../src/tools/builtin/state/swarm-bus';
import { appendSwarmResearchAutonomy } from '../../src/tools/builtin/collaboration/swarm-research-autonomy';
import { TODO_STORE_KEY } from '../../src/tools/builtin/state/todo-list';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../../src/tools/builtin/state/ultrawork-graph';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../src/tools/store';

vi.mock('../../src/tools/support/rg-locator', () => ({
  ensureRgPath: vi.fn(async () => ({ path: '/mock/rg', source: 'system-path' })),
  rgUnavailableMessage: (cause: unknown) =>
    `rg unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
}));

const signal = new AbortController().signal;
const workspace: WorkspaceConfig = { workspaceDir: '/workspace', additionalDirs: [] };

function mockToolStore(initial: Partial<ToolStoreData> = {}): {
  readonly store: ToolStore;
  readonly data: Partial<ToolStoreData>;
} {
  const data: Partial<ToolStoreData> = { ...initial };
  return {
    data,
    store: {
      get<K extends ToolStoreKey>(key: K): ToolStoreData[K] | undefined {
        return data[key];
      },
      set<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
        data[key] = value;
      },
    },
  };
}

function mockSwarmTeam(): TeamPlan {
  return {
    id: 'team_1',
    runId: 'uw_1',
    intensity: 'premium',
    maxExperts: 8,
    experts: [
      {
        id: 'impl-engineer',
        name: 'Impl Engineer',
        role: 'implementation',
        focus: 'implement',
        status: 'queued',
        division: 'engineering',
      },
      {
        id: 'security-appsec-engineer',
        name: 'AppSec Engineer',
        role: 'security',
        focus: 'review',
        status: 'queued',
        division: 'security',
      },
    ],
  };
}

function mockUltraSwarmAgent(
  flags = new FlagResolver({}, FLAG_DEFINITIONS),
  store?: ToolStore,
): Agent {
  return {
    emitEvent: vi.fn(),
    ultraSwarmEngageGate: { clear: vi.fn() },
    experimentalFlags: flags,
    telemetry: { track: vi.fn() },
    ultrawork: {
      attachTeamPlan: vi.fn(),
      getRun: vi.fn(() => null),
    },
    tools: store === undefined ? undefined : { getStore: () => store },
    turn: { hasActiveTurn: false },
    context: { appendSystemReminder: vi.fn() },
  } as unknown as Agent;
}

const regularFileStat = {
  stMode: 0o100_644,
  stIno: 1,
  stDev: 1,
  stNlink: 1,
  stUid: 1000,
  stGid: 1000,
  stSize: 0,
  stAtime: 0,
  stMtime: 0,
  stCtime: 0,
} satisfies Awaited<ReturnType<Kaos['stat']>>;
const directoryStat = {
  ...regularFileStat,
  stMode: 0o040_755,
} satisfies Awaited<ReturnType<Kaos['stat']>>;

function context<Input>(args: Input, toolCallId = 'call_1') {
  return { turnId: '0', toolCallId, args, signal };
}

function mockSubagentHost<T extends Partial<SessionSubagentHost>>(
  host: T,
): T & SessionSubagentHost {
  return {
    spawn: vi.fn(),
    resume: vi.fn(),
    runQueued: vi.fn(),
    getSwarmItem: vi.fn(),
    parentAgentId: 'parent-agent-1',
    startSwarmStandupTimer: vi.fn(() => ({ stop: vi.fn() })),
    ...host,
  } as unknown as T & SessionSubagentHost;
}

function agentTool(host: SessionSubagentHost): AgentTool {
  return new AgentTool(host, createBackgroundManager().manager);
}

function mockSwarmMode(): SwarmMode {
  return { enter: vi.fn() } as unknown as SwarmMode;
}

function agentSwarmTool(host: SessionSubagentHost, swarmMode: SwarmMode): AgentSwarmTool {
  const { store } = mockToolStore();
  return new AgentSwarmTool(host, swarmMode, store);
}

function processWithOutput(stdout: string, exitCode = 0): KaosProcess {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([]);
  return {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: 123,
    exitCode,
    wait: vi.fn().mockResolvedValue(exitCode),
    kill: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(async () => {
      stdoutStream.destroy();
      stderrStream.destroy();
    }),
  };
}

describe('current builtin file and shell tools', () => {
  it('Read exposes parameters and reads text content', async () => {
    const content = 'alpha\nbeta\n';
    const bytes = Buffer.from(content, 'utf8');
    const tool = new ReadTool(
      createFakeKaos({
        stat: vi.fn<Kaos['stat']>().mockResolvedValue(regularFileStat),
        readBytes: vi.fn<Kaos['readBytes']>().mockImplementation(async (_path, n) => {
          return n === undefined ? bytes : bytes.subarray(0, n);
        }),
        readLines: vi.fn<Kaos['readLines']>().mockImplementation(async function* readLines() {
          yield 'alpha\n';
          yield 'beta\n';
        }),
      }),
      workspace,
    );

    expect(ReadInputSchema.safeParse({ path: '/workspace/a.txt' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ path: '/workspace/a.txt' }));
    expect(result.output).toBe(
      [
        '1\talpha',
        '2\tbeta',
        '<system>2 lines read from file starting from line 1. Total lines in file: 2. End of file reached.</system>',
      ].join('\n'),
    );
  });

  it('Write exposes parameters and writes through kaos', async () => {
    const writeText = vi.fn().mockResolvedValue(5);
    const tool = new WriteTool(
      createFakeKaos({ writeText, stat: vi.fn<Kaos['stat']>().mockResolvedValue(directoryStat) }),
      workspace,
    );

    expect(WriteInputSchema.safeParse({ path: '/workspace/a.txt', content: 'hello' }).success).toBe(
      true,
    );
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { content: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ path: '/workspace/a.txt', content: 'hello' }));
    expect(writeText).toHaveBeenCalledWith('/workspace/a.txt', 'hello');
    expect(result.output).toContain('Wrote 5 bytes');
  });

  it('Edit exposes parameters and errors when old_string is missing', async () => {
    const tool = new EditTool(
      createFakeKaos({ readText: vi.fn().mockResolvedValue('alpha\nbeta\n') }),
      workspace,
    );

    expect(
      EditInputSchema.safeParse({
        path: '/workspace/a.txt',
        old_string: 'gamma',
        new_string: 'delta',
      }).success,
    ).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { old_string: { type: 'string' } },
    });

    const result = await executeTool(tool,
      context({ path: '/workspace/a.txt', old_string: 'gamma', new_string: 'delta' }),
    );
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('old_string not found');
  });

  it('Glob exposes parameters and walks pure-wildcard patterns capped at MAX_MATCHES', async () => {
    // Pure wildcards used to be rejected up-front; now they walk like
    // any other pattern and the 100-match cap is the only safety.
    const exec = vi.fn().mockResolvedValue(processWithOutput('a.ts\n'));
    const stat = vi.fn().mockResolvedValue(directoryStat);
    const tool = new GlobTool(createFakeKaos({ exec, stat }), workspace);

    expect(GlobInputSchema.safeParse({ pattern: '*.ts' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { pattern: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ pattern: '**' }));
    expect(result.isError).toBeFalsy();
    expect(exec).toHaveBeenCalled();
    expect((exec.mock.calls[0] as string[]).at(-1)).toBe('.');
    expect(result.output).toContain('a.ts');
  });

  it('Grep exposes parameters and rejects relative workspace escapes before spawning rg', async () => {
    const kaos = createFakeKaos({ exec: vi.fn() });
    const tool = new GrepTool(kaos, workspace);

    expect(GrepInputSchema.safeParse({ pattern: 'needle' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { pattern: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ pattern: 'needle', path: '../outside' }));
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('outside the working directory');
    expect(kaos.exec).not.toHaveBeenCalled();
  });

  it('Bash exposes parameters and returns foreground stdout', async () => {
    const tool = new BashTool(
      createFakeKaos({
        execWithEnv: vi.fn().mockResolvedValue(processWithOutput('ok\n')),
        osEnv: {
          osKind: 'Linux',
          osArch: 'arm64',
          osVersion: 'test',
          shellPath: '/bin/bash',
          shellName: 'bash',
        },
      }),
      '/workspace',
      createBackgroundManager().manager,
    );

    expect(BashInputSchema.safeParse({ command: 'printf ok' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { command: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ command: 'printf ok', timeout: 1000 }));
    expect(result).toMatchObject({ output: 'ok\n' });
  });
});

describe('current builtin collaboration tools', () => {
  it('AskUserQuestion exposes parameters and asks through rpc in yolo mode', async () => {
    const tool = new AskUserQuestionTool({
      experimentalFlags: new FlagResolver({}, FLAG_DEFINITIONS),
      permission: { mode: 'yolo' },
      rpc: {
        requestQuestion: vi.fn(async () => ({ 'Which path?': 'A' })),
      },
      telemetry: { track: vi.fn() },
    } as unknown as Agent);

    const input = {
      questions: [
        {
          question: 'Which path?',
          header: 'Path',
          options: [
            { label: 'A', description: 'Use A' },
            { label: 'B', description: 'Use B' },
          ],
          multi_select: false,
        },
      ],
    };
    expect(AskUserQuestionInputSchema.safeParse(input).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { questions: { type: 'array' } },
    });

    const result = await executeTool(tool, context(input));
    expect(result.output).toBe(JSON.stringify({ answers: { 'Which path?': 'A' } }));
  });

  it('AskUserQuestion documents the answers result shape and dismissal handling', () => {
    // The result is JSON {answers}; a dismissal returns isError:false with empty
    // answers + a note (ask-user.ts), so the description must teach the model to
    // fall back rather than silently re-ask.
    const description = new AskUserQuestionTool({} as unknown as Agent).description.toLowerCase();
    expect(description).toContain('answers');
    expect(description).toContain('dismiss');
  });

  it('Agent exposes parameters and returns a foreground subagent summary', async () => {
    const host = mockSubagentHost({
      spawn: vi.fn().mockResolvedValue({
        agentId: 'agent-child',
        profileName: 'coder',
        resumed: false,
        completion: Promise.resolve({ result: 'child result' }),
      }),
    });
    const tool = agentTool(host);

    const input = { prompt: 'Investigate', description: 'Find cause' };
    expect(AgentToolInputSchema.safeParse(input).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { prompt: { type: 'string' } },
    });

    const result = await executeTool(tool, context(input, 'call_agent'));
    expect(host.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        profileName: 'coder',
        parentToolCallId: 'call_agent',
        prompt: 'Investigate',
        description: 'Find cause',
        runInBackground: false,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.output).toContain('child result');
  });

  it('AgentSwarm applies one subagent_type across templated subagents', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'explore',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-1',
          status: 'completed',
          result: 'explore result a',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'explore',
            parentToolCallId: 'call_swarm',
            prompt: appendSwarmResearchAutonomy('Review src/b.ts'),
            description: 'Review files #2 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-2',
          status: 'completed',
          result: 'explore result b',
        },
      ]),
    });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);
    const input = {
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
      subagent_type: 'explore',
    };

    expect(AgentSwarmToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      AgentSwarmToolInputSchema.safeParse({
        ...input,
        items: Array.from({ length: 128 }, (_, index) => `src/${String(index + 1)}.ts`),
      }).success,
    ).toBe(true);
    expect(
      AgentSwarmToolInputSchema.safeParse({
        ...input,
        items: Array.from({ length: 129 }, (_, index) => `src/${String(index + 1)}.ts`),
      }).success,
    ).toBe(false);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        subagent_type: { type: 'string' },
      },
    });
    expect(Object.keys(tool.parameters['properties'] as Record<string, unknown>).at(-1)).toBe(
      'resume_agent_ids',
    );

    const result = await executeTool(tool, context(input, 'call_swarm'));

    expect(swarmMode.enter).toHaveBeenCalledWith('tool');
    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledWith(
      [
        {
          kind: 'spawn',
          data: {
            kind: 'spawn',
            index: 1,
            item: 'src/a.ts',
            prompt: appendSwarmResearchAutonomy('Review src/a.ts'),
          },
          profileName: 'explore',
          parentToolCallId: 'call_swarm',
          prompt: appendSwarmResearchAutonomy('Review src/a.ts'),
          description: 'Review files #1 (explore)',
          swarmIndex: 1,
          swarmItem: 'src/a.ts',
          runInBackground: false,
          signal,
          timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
        },
        {
          kind: 'spawn',
          data: {
            kind: 'spawn',
            index: 2,
            item: 'src/b.ts',
            prompt: appendSwarmResearchAutonomy('Review src/b.ts'),
          },
          profileName: 'explore',
          parentToolCallId: 'call_swarm',
          prompt: appendSwarmResearchAutonomy('Review src/b.ts'),
          description: 'Review files #2 (explore)',
          swarmIndex: 2,
          swarmItem: 'src/b.ts',
          runInBackground: false,
          signal,
          timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
        },
      ],
    );
    expect(result.output).toContain('<agent_swarm_result>');
    expect(result.output).toContain('agent_id="agent-explore-1"');
    expect(result.output).toContain('explore result a');
    expect(result.output).toContain('[liora-archived id=');
    expect(result.isError).toBeUndefined();
  });

  it('AgentSwarm does not expose permission rule argument matching', () => {
    const tool = agentSwarmTool(mockSubagentHost({}), mockSwarmMode());
    const execution = tool.resolveExecution({
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
    });
    if (execution.isError === true) throw new Error('AgentSwarm resolveExecution returned an error');

    expect(execution.approvalRule).toBe('AgentSwarm');
    expect(execution.matchesRule).toBeUndefined();
  });

  it('AgentSwarm description states the enforced input requirements', () => {
    const description = agentSwarmTool(mockSubagentHost({}), mockSwarmMode()).description;
    // Mirrors the throws in createAgentSwarmSpecs (agent-swarm.ts): min-2-unless-resume,
    // prompt_template required + must contain {{item}}, distinct resulting prompts.
    expect(description).toContain('at least 2');
    expect(description).toContain('{{item}}');
    expect(description.toLowerCase()).toContain('distinct');
    expect(description).toContain('WebSearch and FetchURL as much as needed');
    expect(description).toContain('source URLs');
  });

  it('AgentSwarm rejects more than 128 subagents at execution time', async () => {
    const host = mockSubagentHost({ runQueued: vi.fn() });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: Array.from({ length: 129 }, (_, index) => `src/${String(index + 1)}.ts`),
      }),
    );

    expect(result.output).toBe('AgentSwarm supports at most 128 subagents.');
    expect(result.isError).toBe(true);
    expect(host.runQueued).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a single item without resumed agents',
      input: {
        description: 'Review one file',
        prompt_template: 'Review {{item}}',
        items: ['src/only.ts'],
      },
      output: 'AgentSwarm requires at least 2 items unless resume_agent_ids is provided.',
    },
    {
      name: 'items without a prompt template',
      input: {
        description: 'Review files',
        items: ['src/a.ts', 'src/b.ts'],
      },
      output: 'prompt_template is required when items are provided.',
    },
    {
      name: 'a prompt template without the item placeholder',
      input: {
        description: 'Review files',
        prompt_template: 'Review files',
        items: ['src/a.ts', 'src/b.ts'],
      },
      output: 'prompt_template must include the {{item}} placeholder.',
    },
  ])('AgentSwarm rejects $name at execution time', async ({ input, output }) => {
    const host = mockSubagentHost({ runQueued: vi.fn() });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);

    const result = await executeTool(tool, context(input));

    expect(result.output).toBe(output);
    expect(result.isError).toBe(true);
    expect(host.runQueued).not.toHaveBeenCalled();
  });

  it('AgentSwarm resumes mapped agents before spawning item subagents', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task, index) => ({
          task,
          agentId: task.kind === 'resume' ? task.resumeAgentId : `agent-new-${String(index + 1)}`,
          status: 'completed' as const,
          result: `result ${String(index + 1)}`,
        }));
      },
    );
    const persistedItems: Record<string, string> = {
      'agent-old-1': 'src/old-a.ts',
      'agent-old-2': 'src/old-b.ts',
    };
    const host = mockSubagentHost({
      getSwarmItem: vi.fn((agentId: string) => persistedItems[agentId]),
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);
    const input = {
      description: 'Finish review',
      subagent_type: 'explore',
      prompt_template: 'Review {{item}}',
      items: ['src/new.ts'],
      resume_agent_ids: {
        'agent-old-1': 'Continue previous review A',
        'agent-old-2': 'Continue previous review B',
      },
    };

    expect(AgentSwarmToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      AgentSwarmToolInputSchema.safeParse({
        description: 'Resume two agents',
        resume_agent_ids: {
          'agent-old-1': 'Continue previous review A',
          'agent-old-2': 'Continue previous review B',
        },
      }).success,
    ).toBe(true);
    expect(
      AgentSwarmToolInputSchema.safeParse({
        description: 'Resume one agent',
        resume_agent_ids: {
          'agent-old-1': 'Continue previous review A',
        },
      }).success,
    ).toBe(true);

    const result = await executeTool(tool, context(input, 'call_swarm'));

    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledWith(
      [
        {
          kind: 'resume',
          data: {
            kind: 'resume',
            index: 1,
            agentId: 'agent-old-1',
            item: 'src/old-a.ts',
            prompt: appendSwarmResearchAutonomy('Continue previous review A'),
          },
          profileName: 'subagent',
          parentToolCallId: 'call_swarm',
          prompt: appendSwarmResearchAutonomy('Continue previous review A'),
          description: 'Finish review #1 (resume)',
          swarmIndex: 1,
          swarmItem: 'src/old-a.ts',
          runInBackground: false,
          resumeAgentId: 'agent-old-1',
          signal,
          timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
        },
        {
          kind: 'resume',
          data: {
            kind: 'resume',
            index: 2,
            agentId: 'agent-old-2',
            item: 'src/old-b.ts',
            prompt: appendSwarmResearchAutonomy('Continue previous review B'),
          },
          profileName: 'subagent',
          parentToolCallId: 'call_swarm',
          prompt: appendSwarmResearchAutonomy('Continue previous review B'),
          description: 'Finish review #2 (resume)',
          swarmIndex: 2,
          swarmItem: 'src/old-b.ts',
          runInBackground: false,
          resumeAgentId: 'agent-old-2',
          signal,
          timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
        },
        {
          kind: 'spawn',
          data: {
            kind: 'spawn',
            index: 3,
            item: 'src/new.ts',
            prompt: appendSwarmResearchAutonomy('Review src/new.ts'),
          },
          profileName: 'explore',
          parentToolCallId: 'call_swarm',
          prompt: appendSwarmResearchAutonomy('Review src/new.ts'),
          description: 'Finish review #3 (explore)',
          swarmIndex: 3,
          swarmItem: 'src/new.ts',
          runInBackground: false,
          signal,
          timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
        },
      ],
    );
    expect(result.output).toContain('<agent_swarm_result>');
    expect(result.output).toContain('<summary>completed: 3</summary>');
    expect(result.output).toContain('agent_id="agent-old-1"');
    expect(result.output).toContain('result 3');
    expect(result.output).toContain('[liora-archived id=');
    expect(result.isError).toBeUndefined();
  });

  it('AgentSwarm allows a single resumed subagent without item subagents', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task) => ({
          task,
          agentId: task.kind === 'resume' ? task.resumeAgentId : 'agent-new',
          status: 'completed' as const,
          result: 'resumed result',
        }));
      },
    );
    const host = mockSubagentHost({
      getSwarmItem: vi.fn((agentId: string) =>
        agentId === 'agent-old-1' ? 'src/old-a.ts' : undefined,
      ),
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);
    const input = {
      description: 'Resume review',
      resume_agent_ids: {
        'agent-old-1': 'Continue previous review A',
      },
    };

    expect(AgentSwarmToolInputSchema.safeParse(input).success).toBe(true);

    const result = await executeTool(tool, context(input, 'call_swarm'));

    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledWith([
      {
        kind: 'resume',
        data: {
          kind: 'resume',
          index: 1,
          agentId: 'agent-old-1',
          item: 'src/old-a.ts',
          prompt: appendSwarmResearchAutonomy('Continue previous review A'),
        },
        profileName: 'subagent',
        parentToolCallId: 'call_swarm',
        prompt: appendSwarmResearchAutonomy('Continue previous review A'),
        description: 'Resume review #1 (resume)',
        swarmIndex: 1,
        swarmItem: 'src/old-a.ts',
        runInBackground: false,
        resumeAgentId: 'agent-old-1',
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      },
    ]);
    expect(result.output).toContain('<agent_swarm_result>');
    expect(result.output).toContain('resumed result');
    expect(result.output).toContain('[liora-archived id=');
    expect(result.isError).toBeUndefined();
  });

  it('AgentSwarm reports failed subagents inside the XML result without failing the tool', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-1',
          status: 'completed',
          result: 'imports are stable',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-2',
          status: 'failed',
          error: 'Agent timed out after 30s.',
        },
      ]),
    });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);

    const result = await executeTool(
      tool,
      context(
        {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: ['src/a.ts', 'src/b.ts'],
        },
        'call_swarm',
      ),
    );

    expect(result.output).toContain('<agent_swarm_result>');
    expect(result.output).toContain('<summary>completed: 1, failed: 1</summary>');
    expect(result.output).toContain('<resume_hint>');
    expect(result.output).toContain('imports are stable');
    expect(result.output).toContain('outcome="failed"');
    expect(result.output).toContain('[liora-archived id=');
    expect(swarmMode.enter).toHaveBeenCalledWith('tool');
    expect(result.isError).toBeUndefined();
  });

  it('AgentSwarm omits resume hint when incomplete subagents have no agent ids', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (coder)',
            runInBackground: false,
          },
          status: 'failed',
          error: 'Agent did not start.',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (coder)',
            runInBackground: false,
          },
          status: 'failed',
          error: 'Agent also did not start.',
        },
      ]),
    });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);

    const result = await executeTool(
      tool,
      context(
        {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: ['src/a.ts', 'src/b.ts'],
        },
        'call_swarm',
      ),
    );

    expect(result.output).toContain('<agent_swarm_result>');
    expect(result.output).toContain('<summary>failed: 2</summary>');
    expect(result.output).toContain('Agent did not start.');
    expect(result.output).toContain('[liora-archived id=');
    expect(result.isError).toBeUndefined();
  });

  it('AgentSwarm reports partial aborted subagents inside the XML result', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-1',
          status: 'completed',
          result: 'imports are stable',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-2',
          status: 'aborted',
          state: 'started',
          error: 'The user manually interrupted this subagent batch before this subagent finished.',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 3, item: 'src/c.ts', prompt: 'Review src/c.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_swarm',
            prompt: 'Review src/c.ts',
            description: 'Review files #3 (coder)',
            runInBackground: false,
          },
          status: 'aborted',
          state: 'not_started',
          error: 'The user manually interrupted this subagent batch before this subagent was started.',
        },
      ]),
    });
    const swarmMode = mockSwarmMode();
    const tool = agentSwarmTool(host, swarmMode);

    const result = await executeTool(
      tool,
      context(
        {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        },
        'call_swarm',
      ),
    );

    expect(result.output).toContain('<agent_swarm_result>');
    expect(result.output).toContain('<summary>completed: 1, aborted: 2</summary>');
    expect(result.output).toContain('<resume_hint>');
    expect(result.output).toContain('imports are stable');
    expect(result.output).toContain('outcome="aborted"');
    expect(result.output).toContain('[liora-archived id=');
    expect(result.isError).toBeUndefined();
  });

  it('UltraSwarm runs selected experts as named expert subagents', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> =>
        tasks.map((task, index) => ({
          task,
          agentId: `agent-expert-${String(index + 1)}`,
          status: 'completed' as const,
          result: `expert result ${String(index + 1)}`,
        })),
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const swarmMode = mockSwarmMode();
    const { store } = mockToolStore();
    const agent = mockUltraSwarmAgent();
    const tool = new UltraSwarmTool(host, swarmMode, store, agent);
    const input = {
      description: 'Review the product launch plan',
      run_id: 'uw_1',
      experts: ['academic-anthropologist', 'design-brand-guardian'],
      required_experts: ['academic-anthropologist'],
      auto_select: false,
      subagent_type: 'explore',
      run_in_background: true,
      intensity: 'premium' as const,
      max_experts: 2,
      focus: 'review' as const,
    };

    expect(UltraSwarmToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      UltraSwarmToolInputSchema.safeParse({
        ...input,
        max_experts: 128,
        experts: Array.from({ length: 128 }, (_, index) => `expert-${String(index + 1)}`),
      }).success,
    ).toBe(true);
    expect(
      UltraSwarmToolInputSchema.safeParse({
        ...input,
        max_experts: 128,
        experts: Array.from({ length: 129 }, (_, index) => `expert-${String(index + 1)}`),
      }).success,
    ).toBe(false);

    const result = await executeTool(tool, context(input, 'call_ultra_swarm'));

    expect(swarmMode.enter).toHaveBeenCalledWith('tool');
    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'spawn',
        profileName: 'academic-anthropologist',
        profileBaseName: 'explore',
        parentToolCallId: 'call_ultra_swarm',
        description: expect.stringContaining('(Anthropologist'),
        swarmIndex: 1,
        swarmItem: 'academic-anthropologist',
        runInBackground: true,
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      }),
      expect.objectContaining({
        kind: 'spawn',
        profileName: 'design-brand-guardian',
        profileBaseName: 'explore',
        parentToolCallId: 'call_ultra_swarm',
        description: expect.stringContaining('(Brand Guardian'),
        swarmIndex: 2,
        swarmItem: 'design-brand-guardian',
        runInBackground: true,
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      }),
    ]);
    const queuedTasks = runQueued.mock.calls[0]?.[0] ?? [];
    expect(queuedTasks[0]?.prompt).toContain('<expert_briefing');
    expect(queuedTasks[0]?.prompt).not.toContain('<expert_persona');
    expect(queuedTasks[0]?.prompt).toContain('Coverage lane: domain_subject_matter.');
    expect(queuedTasks[0]?.prompt).toContain('Selection reason:');
    expect(queuedTasks[0]?.prompt).toContain('Focus lane: review.');
    expect(queuedTasks[0]?.prompt).toContain('VERDICT: PASS');
    expect(queuedTasks[0]?.prompt).toContain('<swarm_research_autonomy>');
    expect(queuedTasks[0]?.prompt).toContain('WebSearch and FetchURL as often as needed');
    expect(result.output).toContain('<ultra_swarm_result run_id="uw_1">');
    expect(result.output).toContain('<summary>completed: 2, failed: 0, aborted: 0</summary>');
    expect(result.output).toContain('<coverage>Each expert row includes the assigned coverage lane');
    expect(result.output).toContain('coverage_lane="domain_subject_matter"');
    expect(result.output).toContain('verdict="PASS"');
    expect(result.output).toContain('required_for_completion="true"');
    expect(result.output).toContain('<selection_reason>');
    expect(result.output).toContain('expert result 1');
    expect(result.output).toContain('[liora-archived id=');
    expect(result.isError).toBeUndefined();
    expect(agent.emitEvent).toHaveBeenCalledWith({
      type: 'ultrawork.team.staffed',
      runId: 'uw_1',
      toolCallId: 'call_ultra_swarm',
      team: expect.objectContaining({
        intensity: 'premium',
        experts: expect.arrayContaining([
          expect.objectContaining({
            id: 'academic-anthropologist',
            coverageLane: 'domain_subject_matter',
            focus: 'review',
            emoji: expect.any(String),
          }),
        ]),
      }),
    });
    expect(agent.ultraSwarmEngageGate.clear).toHaveBeenCalledWith('ultra-swarm-completed');
  });

  it('UltraSwarm runs phased batches and passes bounded handoffs forward', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> =>
        tasks.map((task) => ({
          task,
          agentId: `agent-${String((task.data as { phase?: string }).phase ?? 'phase')}`,
          status: 'completed' as const,
          result: `${(task.data as { phase?: string }).phase ?? 'phase'} handoff evidence_ids: ev_${String(runQueued.mock.calls.length)}`,
        })),
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const { store } = mockToolStore();
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, mockUltraSwarmAgent());

    const result = await executeTool(
      tool,
      context({
        description: 'Implement a feature with product, architecture, and QA review',
        run_id: 'uw_phased',
        experts: ['product-manager', 'engineering-software-architect', 'testing-evidence-collector'],
        auto_select: false,
        max_experts: 3,
        focus: 'full',
      }),
    );

    expect(runQueued).toHaveBeenCalledTimes(3);
    expect(runQueued.mock.calls[0]?.[0]).toHaveLength(1);
    expect(runQueued.mock.calls[1]?.[0]?.[0]?.prompt).toContain('<previous_phase_handoff>');
    expect(runQueued.mock.calls[1]?.[0]?.[0]?.prompt).toContain('plan handoff');
    expect(runQueued.mock.calls[2]?.[0]?.[0]?.prompt).toContain('implement handoff');
    expect(result.output).toContain('phase="plan"');
    expect(result.output).toContain('phase="implement"');
    expect(result.output).toContain('phase="review"');
    expect(result.output).toContain('<integration_handoff>');
  });

  it('UltraSwarm attaches critic edges to review experts and retries blocked reviews once', async () => {
    let reviewAttempt = 0;
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> =>
        tasks.map((task) => {
          const phase = (task.data as { phase?: string }).phase ?? 'phase';
          if (phase === 'review') {
            reviewAttempt += 1;
            const verdict = reviewAttempt === 1 ? 'VERDICT: BLOCKED needs tests' : 'VERDICT: PASS';
            return {
              task,
              agentId: 'agent-review',
              status: 'completed' as const,
              result: verdict,
            };
          }
          return {
            task,
            agentId: `agent-${phase}`,
            status: 'completed' as const,
            result: `${phase} handoff evidence_ids: ev_${phase}`,
          };
        }),
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const { store } = mockToolStore();
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, mockUltraSwarmAgent());

    const result = await executeTool(
      tool,
      context({
        description: 'Implement a feature with product, architecture, and QA review',
        run_id: 'uw_review_retry',
        experts: ['product-manager', 'engineering-software-architect', 'testing-evidence-collector'],
        auto_select: false,
        max_experts: 3,
        focus: 'full',
      }),
    );

    expect(runQueued).toHaveBeenCalledTimes(4);
    const reviewPrompts = runQueued.mock.calls
      .flatMap((call) => call[0] ?? [])
      .map((task) => task.prompt)
      .filter((prompt) => prompt.includes('UltraSwarm phase: review'));
    expect(reviewPrompts.some((prompt) => prompt.includes('<critic_assignment>'))).toBe(true);
    expect(reviewPrompts.some((prompt) => prompt.includes('<review_revision_request>'))).toBe(true);
    expect(result.output).toContain('verdict="PASS"');
    expect(result.output).not.toContain('VERDICT: BLOCKED');
  });

  it('UltraSwarm restaffs additional experts when revision gaps remain', async () => {
    const originalBuildSwarmPlan = globalUltraSwarmOrchestrator.buildSwarmPlan.bind(
      globalUltraSwarmOrchestrator,
    );
    const buildSwarmPlanSpy = vi
      .spyOn(globalUltraSwarmOrchestrator, 'buildSwarmPlan')
      .mockImplementation(async (description, expertIds, options) => {
        if (description.includes('revision staffing')) {
          return {
            taskDescription: description,
            strategy: 'parallel' as const,
            experts: [
              {
                expertId: 'security-appsec-engineer',
                expertName: 'AppSec Engineer',
                prompt: 'Close remaining security and QA gaps.',
                division: 'Security',
                emoji: '🔒',
                color: 'red',
                coverageLane: 'security_privacy',
              },
            ],
          };
        }
        return originalBuildSwarmPlan(description, expertIds, options);
      });

    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> =>
        tasks.map((task) => {
          const phase = (task.data as { phase?: string }).phase ?? 'phase';
          const profileName = task.profileName ?? '';
          if (phase === 'review' && profileName === 'testing-evidence-collector') {
            return {
              task,
              agentId: 'agent-review',
              status: 'completed' as const,
              result: 'VERDICT: BLOCKED needs tests',
            };
          }
          if (phase === 'review' && profileName === 'security-appsec-engineer') {
            return {
              task,
              agentId: 'agent-restaff',
              status: 'completed' as const,
              result: 'VERDICT: PASS security gaps closed',
            };
          }
          return {
            task,
            agentId: `agent-${phase}`,
            status: 'completed' as const,
            result: `${phase} handoff evidence_ids: ev_${phase}`,
          };
        }),
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const { store } = mockToolStore();
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, mockUltraSwarmAgent());

    const result = await executeTool(
      tool,
      context({
        description: 'Implement a feature with product, architecture, and QA review',
        run_id: 'uw_restaff',
        experts: ['product-manager', 'engineering-software-architect', 'testing-evidence-collector'],
        auto_select: false,
        max_experts: 5,
        focus: 'full',
      }),
    );

    expect(buildSwarmPlanSpy).toHaveBeenCalledWith(
      expect.stringContaining('revision staffing'),
      undefined,
      expect.objectContaining({ maxExperts: 2 }),
    );
    expect(runQueued).toHaveBeenCalledTimes(5);
    expect(result.output).toContain('security-appsec-engineer');
    expect(result.output).toContain('Restaffed after revision gaps.');
    buildSwarmPlanSpy.mockRestore();
  });

  it('UltraSwarm blocks dependent phases when a required planning expert blocks', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> =>
        tasks.map((task) => ({
          task,
          agentId: 'agent-product',
          status: 'completed' as const,
          result: 'VERDICT: BLOCKED\nRequirements are not testable yet.',
        })),
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const { store } = mockToolStore();
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, mockUltraSwarmAgent());

    const result = await executeTool(
      tool,
      context({
        description: 'Implement a risky feature',
        run_id: 'uw_blocked',
        experts: ['product-manager', 'engineering-software-architect', 'testing-evidence-collector'],
        required_experts: ['product-manager'],
        auto_select: false,
        max_experts: 3,
        focus: 'full',
      }),
    );

    expect(runQueued).toHaveBeenCalledTimes(1);
    expect(result.output).toContain('verdict="BLOCKED"');
    expect(result.output).toContain('outcome="aborted"');
    expect(result.output).toContain('Skipped because required plan expert product-manager returned BLOCKED.');
  });

  it('UltraSwarm keeps the ENGAGE gate when execution fails before returning results', async () => {
    const runQueued = vi.fn(async () => {
      throw new Error('provider unavailable');
    });
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const { store } = mockToolStore();
    const agent = mockUltraSwarmAgent();
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, agent);

    const result = await executeTool(
      tool,
      context({
        description: 'Review a feature',
        run_id: 'uw_failed',
        experts: ['product-manager'],
        auto_select: false,
        max_experts: 1,
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('provider unavailable');
    expect(agent.ultraSwarmEngageGate.clear).not.toHaveBeenCalled();
  });

  it('UltraSwarm binds work_node_ids to WorkGraph contracts and updates node evidence', async () => {
    const graph: WorkGraph = {
      id: 'wg_1',
      runId: 'uw_1',
      rootGoal: 'Ship the harness',
      nodes: [
        {
          id: 'ac_1',
          title: 'Implement graph harness',
          kind: 'implementation',
          stage: 'swarm',
          status: 'queued',
          acceptanceCriterionId: 'AC-1',
          laneId: 'implementation',
          requiredEvidence: ['unit test'],
        },
      ],
    };
    const { store, data } = mockToolStore({ [ULTRAWORK_GRAPH_STORE_KEY]: graph });
    const emitEvent = vi.fn();
    const agent = {
      emitEvent,
      experimentalFlags: new FlagResolver({}, FLAG_DEFINITIONS),
      telemetry: { track: vi.fn() },
      ultraSwarmEngageGate: { clear: vi.fn() },
      ultrawork: {
        attachTeamPlan: vi.fn(),
        getRun: vi.fn(() => null),
      },
    } as unknown as Agent;
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> =>
        tasks.map((task) => ({
          task,
          agentId: 'agent-expert-1',
          status: 'completed' as const,
          result: 'VERDICT: PASS\nevidence_ids: ev_1, ev_2',
        })),
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, agent);

    const result = await executeTool(
      tool,
      context({
        description: 'Implement the graph harness',
        run_id: 'uw_1',
        work_node_ids: ['ac_1'],
        experts: ['academic-anthropologist'],
        auto_select: false,
        max_experts: 1,
        focus: 'implement',
      }),
    );

    const queuedTasks = runQueued.mock.calls[0]?.[0] ?? [];
    expect(queuedTasks[0]).toMatchObject({
      swarmItem: 'ac_1',
      profileName: 'academic-anthropologist',
    });
    expect(queuedTasks[0]?.prompt).toContain('<work_node_contracts>');
    expect(queuedTasks[0]?.prompt).toContain('acceptance_criterion_id="AC-1"');
    expect(result.output).toContain('work_node_ids="ac_1"');
    expect(result.output).toContain('evidence_ids="ev_1,ev_2"');

    const updated = data[ULTRAWORK_GRAPH_STORE_KEY] as WorkGraph;
    expect(updated.nodes[0]).toMatchObject({
      id: 'ac_1',
      status: 'done',
      ownerExpertId: 'academic-anthropologist',
      ownerAgentId: 'agent-expert-1',
      evidenceIds: ['ev_1', 'ev_2'],
      verificationStatus: 'passed',
    });
    expect(data[TODO_STORE_KEY]).toEqual([
      { title: '[ac_1] Implement graph harness', status: 'done' },
    ]);
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'ultrawork.task.assigned',
      runId: 'uw_1',
      task: expect.objectContaining({ id: 'ac_1', status: 'running' }),
    });
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'ultrawork.task.assigned',
      runId: 'uw_1',
      task: expect.objectContaining({ id: 'ac_1', status: 'done' }),
    });
  });

  it('UltraSwarm explains when work_node_ids is used without a seeded graph', async () => {
    const host = mockSubagentHost({});
    const { store } = mockToolStore();
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, mockUltraSwarmAgent());

    const result = await executeTool(tool, context({
      description: 'Implement the graph harness',
      work_node_ids: ['ac_1'],
      experts: ['academic-anthropologist'],
      auto_select: false,
      max_experts: 1,
    }));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('work_node_ids requires an existing UltraworkGraph');
    expect(result.output).toContain('ExitPlanMode');
  });

  it('UltraSwarm rejects explicit expert requests above max_experts', async () => {
    const host = mockSubagentHost({});
    const { store } = mockToolStore();
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, mockUltraSwarmAgent());

    const result = await executeTool(tool, context({
      description: 'Run a focused review',
      experts: ['academic-anthropologist', 'design-brand-guardian'],
      auto_select: false,
      max_experts: 1,
    }));

    expect(result.isError).toBe(true);
    expect(result.output).toContain('max_experts is 1');
  });

  it('UltraSwarm always injects swarm bus roster rules during runs', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> =>
        tasks.map((task) => ({
          task,
          agentId: 'agent-expert-1',
          status: 'completed' as const,
          result: 'expert result',
        })),
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const { store } = mockToolStore();
    const agent = mockUltraSwarmAgent(undefined, store);
    const tool = new UltraSwarmTool(host, mockSwarmMode(), store, agent);

    await executeTool(
      tool,
      context(
        {
          description: 'Review the product launch plan',
          run_id: 'uw_1',
          experts: ['academic-anthropologist'],
          auto_select: false,
          max_experts: 1,
          focus: 'review',
        },
        'call_ultra_swarm',
      ),
    );

    const prompts = runQueued.mock.calls.flatMap(
      (call) => call[0]?.map((task) => task.prompt) ?? [],
    );
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((prompt) => prompt.includes('<team_roster>'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('<swarm_channel_rules>'))).toBe(true);
    expect(agent.ultraSwarmRun).toBeUndefined();
    expect(host.startSwarmStandupTimer).toHaveBeenCalledTimes(1);
  });

  it('renderSwarmBusDigest prioritizes verdict and blocker messages', () => {
    const { store } = mockToolStore();
    initSwarmRunBus(store, {
      runId: 'uw_1',
      parentToolCallId: 'call_uw',
      team: mockSwarmTeam(),
    });
    const post = (input: {
      channel: 'lane' | 'blocker' | 'council';
      kind: 'status' | 'verdict' | 'artifact_ref';
      body: string;
      expertId: string;
      name: string;
    }) => {
      const state = store.get('swarm_bus');
      if (state === undefined) throw new Error('missing bus');
      state.messages.push({
        id: `msg-${input.body}`,
        runId: 'uw_1',
        parentToolCallId: 'call_uw',
        at: new Date().toISOString(),
        from: {
          expertId: input.expertId,
          agentId: `agent-${input.expertId}`,
          name: input.name,
        },
        channel: input.channel,
        kind: input.kind,
        body: input.body,
      });
    };
    post({
      channel: 'lane',
      kind: 'status',
      body: 'routine lane update',
      expertId: 'impl-engineer',
      name: 'Impl Engineer',
    });
    post({
      channel: 'blocker',
      kind: 'status',
      body: 'missing auth tests',
      expertId: 'security-appsec-engineer',
      name: 'AppSec Engineer',
    });
    post({
      channel: 'council',
      kind: 'verdict',
      body: 'VERDICT: BLOCKED',
      expertId: 'security-appsec-engineer',
      name: 'AppSec Engineer',
    });
    post({
      channel: 'lane',
      kind: 'artifact_ref',
      body: 'patch-plan-v2',
      expertId: 'impl-engineer',
      name: 'Impl Engineer',
    });

    const digest = renderSwarmBusDigest(store, { limit: 4 });
    expect(digest.indexOf('VERDICT: BLOCKED')).toBeLessThan(digest.indexOf('missing auth tests'));
    expect(digest.indexOf('patch-plan-v2')).toBeLessThan(digest.indexOf('routine lane update'));
  });

  it('SwarmChannel post/list/reply coordinates through the swarm bus store', async () => {
    const { store } = mockToolStore();
    const team = mockSwarmTeam();
    initSwarmRunBus(store, { runId: 'uw_1', parentToolCallId: 'call_uw', team });
    const parent = mockUltraSwarmAgent();
    const run = createUltraSwarmRunContext({
      runId: 'uw_1',
      parentToolCallId: 'call_uw',
      team,
      busEnabled: true,
    });
    const expert = team.experts[0]!;
    const onMessagePosted = vi.fn();
    const tool = new SwarmChannelTool({
      parentAgent: parent,
      parentStore: store,
      run,
      expert,
      childAgentId: 'child-1',
      onMessagePosted,
    });

    const postResult = await executeTool(
      tool,
      context({
        action: 'post',
        channel: 'direct',
        kind: 'question',
        body: 'Need auth review @security-appsec-engineer',
        to_expert_id: 'security-appsec-engineer',
      }),
    );
    expect(postResult.isError).toBeUndefined();
    expect(onMessagePosted).toHaveBeenCalledOnce();

    const listResult = await executeTool(tool, context({ action: 'list', channel: 'direct' }));
    expect(listResult.output).toContain('Impl Engineer');
    expect(listResult.output).toContain('Need auth review');

    const replyResult = await executeTool(
      tool,
      context({
        action: 'reply',
        thread_id: 'thread-1',
        body: 'Will add tests next.',
      }),
    );
    expect(replyResult.isError).toBeUndefined();
    expect(replyResult.output).toContain('Posted to Swarm bus.');
  });

  it('SwarmChannel enforces allowlist and rate limits on the swarm bus', async () => {
    const { store } = mockToolStore();
    const team = mockSwarmTeam();
    initSwarmRunBus(store, { runId: 'uw_1', parentToolCallId: 'call_uw', team });
    const run = createUltraSwarmRunContext({
      runId: 'uw_1',
      parentToolCallId: 'call_uw',
      team,
      busEnabled: true,
    });
    const tool = new SwarmChannelTool({
      parentAgent: mockUltraSwarmAgent(),
      parentStore: store,
      run,
      expert: {
        id: 'unknown-expert',
        name: 'Unknown',
        role: 'implementation',
        focus: 'implement',
        status: 'queued',
        division: 'engineering',
      },
      childAgentId: 'child-2',
    });

    const blocked = await executeTool(
      tool,
      context({ action: 'post', channel: 'lane', body: 'hello team' }),
    );
    expect(blocked.isError).toBe(true);
    expect(blocked.output).toContain('not on the staffed team');

    const allowedTool = new SwarmChannelTool({
      parentAgent: mockUltraSwarmAgent(),
      parentStore: store,
      run,
      expert: team.experts[0]!,
      childAgentId: 'child-1',
    });
    for (let index = 0; index < 12; index += 1) {
      const result = await executeTool(
        allowedTool,
        context({ action: 'post', channel: 'lane', body: `status ${String(index)}` }),
      );
      expect(result.isError).toBeUndefined();
    }
    const throttled = await executeTool(
      allowedTool,
      context({ action: 'post', channel: 'lane', body: 'one too many' }),
    );
    expect(throttled.isError).toBe(true);
    expect(throttled.output).toContain('rate limit');
  });

  it('SwarmChannel publishes typed artifacts with artifact_ref bus messages', async () => {
    const { store } = mockToolStore();
    const team = mockSwarmTeam();
    initSwarmRunBus(store, { runId: 'uw_1', parentToolCallId: 'call_uw', team });
    const run = createUltraSwarmRunContext({
      runId: 'uw_1',
      parentToolCallId: 'call_uw',
      team,
      busEnabled: true,
    });
    const onMessagePosted = vi.fn();
    const tool = new SwarmChannelTool({
      parentAgent: mockUltraSwarmAgent(),
      parentStore: store,
      run,
      expert: team.experts[0]!,
      childAgentId: 'child-1',
      onMessagePosted,
    });

    const result = await executeTool(
      tool,
      context({
        action: 'artifact',
        artifact_kind: 'patch_plan',
        title: 'Auth middleware patch plan',
        body: 'Add integration tests for auth middleware hooks.',
      }),
    );

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('artifact_id=');
    expect(onMessagePosted).toHaveBeenCalledOnce();
    const bus = store.get('swarm_bus');
    expect(Object.keys(bus?.artifacts ?? {})).toHaveLength(1);
    expect(bus?.messages.at(-1)?.kind).toBe('artifact_ref');
  });

  it('Skill exposes parameters and reports unknown skills as tool errors', async () => {
    const tool = new SkillTool({
      skills: {
        registry: new SessionSkillRegistry(),
        recordActivation: vi.fn(),
      },
      context: {
        appendSystemReminder: vi.fn(),
      },
    } as unknown as Agent);

    expect(SkillToolInputSchema.safeParse({ skill: 'missing' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { skill: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ skill: 'missing' }));
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('not found');
  });

  it('SearchSkill exposes parameters and returns matching skill candidates', async () => {
    const registry = new SessionSkillRegistry();
    registry.register({
      name: 'write-tui',
      description: 'Terminal UI work',
      path: '/skills/write-tui/SKILL.md',
      dir: '/skills/write-tui',
      content: 'body',
      metadata: {},
      source: 'user',
    });
    const tool = new SearchSkillTool({
      skills: { registry },
    } as unknown as Agent);

    expect(SearchSkillInputSchema.safeParse({ query: 'tui approval' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ query: 'tui approval' }));
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('<skill-search-results query="tui approval">');
    expect(result.output).toContain('name="write-tui"');
  });

  it('SearchExpert exposes parameters and returns matching expert candidates', async () => {
    const tool = new SearchExpertTool();

    expect(SearchExpertInputSchema.safeParse({ query: 'brand guardian design review' }).success).toBe(
      true,
    );
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ query: 'brand guardian design review' }));
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('<expert-search-results query="brand guardian design review">');
    expect(result.output).toContain('<expert-candidate');
    expect(result.output).toContain('id="design-brand-guardian"');
    expect(result.output).toContain('UltraSwarm');
  });
});

describe('current builtin background tool schemas', () => {
  it('background task schemas and manager-backed tools are covered', () => {
    const manager = createBackgroundManager().manager;

    expect(TaskListInputSchema.safeParse({ active_only: true }).success).toBe(true);
    expect(TaskOutputInputSchema.safeParse({ task_id: 'bash-1' }).success).toBe(true);
    expect(TaskStopInputSchema.safeParse({ task_id: 'bash-1' }).success).toBe(true);
    expect(manager.list()).toEqual([]);
  });
});
