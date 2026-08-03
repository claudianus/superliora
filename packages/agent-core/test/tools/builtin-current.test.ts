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
} from '../../src/session/subagent/subagent-host';
import { SessionSkillRegistry } from '../../src/skill';
import { TaskListInputSchema } from '../../src/tools/background/task-list';
import { TaskOutputInputSchema } from '../../src/tools/background/task-output';
import { TaskStopInputSchema } from '../../src/tools/background/task-stop';
import { AgentTool, AgentToolInputSchema } from '../../src/tools/builtin/fleet/agent';
import {
  AskUserQuestionInputSchema,
  AskUserQuestionTool,
} from '../../src/tools/builtin/fleet/ask-user';
import {
  SearchExpertInputSchema,
  SearchExpertTool,
} from '../../src/tools/builtin/fleet/search-expert';
import {
  SearchSkillInputSchema,
  SearchSkillTool,
} from '../../src/tools/builtin/fleet/search-skill';
import { SkillTool, SkillToolInputSchema } from '../../src/tools/builtin/fleet/skill-tool';
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
import { AgentSwarmTool } from '../../src/tools/builtin/fleet/agent-swarm';
import { UltraSwarmTool } from '../../src/tools/builtin/fleet/ultra-swarm';
import { SwarmChannelTool } from '../../src/tools/builtin/fleet/swarm-channel';
import { createUltraSwarmRunContext } from '../../src/agent/ultra-swarm-run';
import { initSwarmRunBus, renderSwarmBusDigest } from '../../src/tools/builtin/state/swarm-bus';
import { TODO_STORE_KEY } from '../../src/tools/builtin/state/todo-list';
import { ULTRAWORK_GRAPH_STORE_KEY } from '#/mission';
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
    fullCompaction: { ensureBelowHandoffThreshold: vi.fn().mockResolvedValue(undefined) },
    experimentalFlags: flags,
    telemetry: { track: vi.fn() },
    ultrawork: {
      attachTeamPlan: vi.fn(),
      getRun: vi.fn(() => null),
      syncWorkGraphFromStore: vi.fn(() => undefined),
      completeLearnStage: vi.fn(() => null),
      isModeEnabled: vi.fn(() => true),
      getInterruptReason: vi.fn(() => undefined),
    },
    goal: {
      getGoal: vi.fn(() => ({ goal: null })),
      markComplete: vi.fn(async () => null),
    },
    planMode: { isActive: false, isUltraMode: false },
    swarmMode: { isActive: false },
    records: { recordCount: vi.fn(() => 0), logRecord: vi.fn() },
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
    parentLoopToolNames: vi.fn(() => []),
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

function mockSwarmAgent(cwd = '/workspace/project'): Agent {
  return {
    kaos: createFakeKaos(cwd),
    config: { cwd },
    log: {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      createChild: vi.fn(),
    },
  } as unknown as Agent;
}

function agentSwarmTool(
  host: SessionSubagentHost,
  swarmMode: SwarmMode,
  agent: Agent = mockSwarmAgent(),
): AgentSwarmTool {
  const { store } = mockToolStore();
  return new AgentSwarmTool(host, swarmMode, store, agent);
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
        '<tool_meta tool="Read" mode="lines">',
        'truncated: false',
        'partial: false',
        'summary: 2 lines read from file starting from line 1. Total lines in file: 2. End of file reached.',
        'rendered_lines: 2',
        'start_line: 1',
        'total_lines: 2',
        'next_step: Use Edit with exact visible bytes, or call Read again with line_offset/n_lines to page.',
        '</tool_meta>',
      ].join('\n'),
    );
  });

  it('Write exposes parameters and writes through kaos', async () => {
    const writeAtomic = vi.fn().mockResolvedValue(undefined);
    const tool = new WriteTool(
      createFakeKaos({ writeAtomic, stat: vi.fn<Kaos['stat']>().mockResolvedValue(directoryStat) }),
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
    expect(writeAtomic).toHaveBeenCalledWith('/workspace/a.txt', 'hello');
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
  it('AskUserQuestion exposes parameters and auto-answers in auto mode', async () => {
    const requestQuestion = vi.fn(async () => ({ 'Which path?': 'A' }));
    const tool = new AskUserQuestionTool({
      experimentalFlags: new FlagResolver({}, FLAG_DEFINITIONS),
      permission: { mode: 'auto' },
      rpc: {
        requestQuestion,
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
    const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
    expect(output.method).toBe('auto');
    expect(output.answers['Which path?']).toContain('A');
    expect(output.decisions?.[0]).toMatchObject({
      question: 'Which path?',
      chosen: 'A',
      source: 'baseline',
    });
    expect(requestQuestion).not.toHaveBeenCalled();
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

  it('AgentSwarm does not expose permission rule argument matching', () => {
    const tool = agentSwarmTool(mockSubagentHost({}), mockSwarmMode());
    const execution = tool.resolveExecution({
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
    });
    if (execution.isError === true) throw new Error('AgentSwarm resolveExecution returned an error');

    expect(execution.approvalRule).toBe('Fleet');
    expect(execution.matchesRule).toBeUndefined();
  });

  it('AgentSwarm description states the enforced input requirements', () => {
    const description = agentSwarmTool(mockSubagentHost({}), mockSwarmMode()).description;
    // Mirrors the throws in createAgentSwarmSpecs (agent-swarm.ts): min-2-unless-resume,
    // prompt_template required + must contain {{item}}, distinct resulting prompts.
    expect(description).toContain('at least 2');
    expect(description).toContain('{{item}}');
    expect(description.toLowerCase()).toContain('distinct');
    expect(description).toContain('Context7Resolve/Context7Docs');
    expect(description).toContain('WebSearch/FetchURL');
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
