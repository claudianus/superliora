import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';

import { createControlledPromise } from '@antfu/utils';
import { type Environment, type Kaos, type KaosProcess } from '@superliora/kaos';
import type { ModelCapability, ProviderConfig } from '@superliora/kosong';
import { expect, onTestFinished, vi } from 'vitest';

import {
  Agent,
  type AgentOptions,
  type AgentRecord,
} from '../../../src/agent';
import type { AgentRecordPersistence } from '../../../src/agent/records';
import type { ApprovalResponse } from '../../../src/agent/permission';
import {
  AGENT_WIRE_PROTOCOL_VERSION,
  InMemoryAgentRecordPersistence,
} from '../../../src/agent/records';
import type { LioraConfig } from '../../../src/config';
import type { Logger } from '../../../src/logging';
import { ProviderManager } from '../../../src/session/provider/provider-manager';
import type { RPCCallOptions, SDKAgentRPC } from '../../../src/rpc';
import type { AgentAPI } from '../../../src/rpc/core-api';
import type { TelemetryClient } from '../../../src/telemetry';
import type { PromisifyMethods } from '../../../src/utils/types';
import { createFakeKaos } from '../../tools/fixtures/fake-kaos';
import { testKaos } from '../../fixtures/test-kaos';

import { createScriptedGenerate } from './scripted-generate';
import {
  DEFAULT_TEST_SYSTEM_PROMPT,
  eventSnapshot,
  type EventSnapshotEntry,
  type RpcSnapshotEntry,
  type WireSnapshotEntry,
} from './snapshots';

const TEST_OS_ENV: Environment = {
  osKind: 'Linux',
  osArch: 'x86_64',
  osVersion: 'test',
  shellName: 'bash',
  shellPath: '/bin/bash',
};

const MOCK_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'mock-model',
} as const;

const RPC_RESPONSE = Symbol('rpcResponse');

type RpcPromise<T> = Promise<T> & {
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

type RpcLogEntry = RpcSnapshotEntry & {
  readonly [RPC_RESPONSE]?: RpcPromise<unknown>;
};

type PromiseAgentAPI = PromisifyMethods<AgentAPI>;
type GenerateFn = NonNullable<AgentOptions['generate']>;


interface ResumeStateSnapshot {
  readonly background: ReturnType<Agent['background']['list']>;
  readonly config: {
    readonly cwd: string;
    readonly provider: ProviderConfig | undefined;
    readonly profileName: string | undefined;
    readonly thinkingLevel: string;
    readonly systemPrompt: string;
  };
  readonly context: ReturnType<Agent['context']['data']>;
  readonly permission: ReturnType<Agent['permission']['data']>;
  readonly usage: ReturnType<Agent['usage']['data']>;
}

export interface TestAgentOptions {
  readonly kaos?: Kaos | undefined;
  readonly generate?: GenerateFn | undefined;
  readonly type?: AgentOptions['type'];
  readonly permission?: AgentOptions['permission'];
  readonly providerManager?: ProviderManager;
  readonly initialConfig?: LioraConfig;
  readonly providerManagerOverrides?: Omit<ConstructorParameters<typeof ProviderManager>[0], 'config'>;
  readonly sessionId?: string;
  readonly sessionControl?: AgentOptions['sessionControl'];
  readonly onEvent?: ((event: AgentRecord) => AgentRecord | undefined) | undefined;
  readonly persistence?: AgentRecordPersistence | undefined;
  readonly homedir?: AgentOptions['homedir'];
  readonly telemetry?: TelemetryClient | undefined;
  readonly log?: Logger;
}

interface ConfigureOptions {
  readonly provider?: ProviderConfig | undefined;
  readonly modelCapabilities?: ModelCapability | undefined;
}

export type TestAgentContext = AgentTestContext;

export function createCommandKaos(stdout: string): Kaos {
  function createProcess(): KaosProcess {
    return {
      stdin: new PassThrough(),
      stdout: Readable.from([stdout]),
      stderr: Readable.from(['']),
      pid: 42,
      exitCode: 0,
      wait: vi.fn().mockResolvedValue(0),
      kill: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
  }

  return createFakeKaos({
    execWithEnv: vi.fn().mockImplementation(async () => createProcess()),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeText: vi.fn(async (_path: string, content: string) => content.length),
  });
}

export function testAgent(options: TestAgentOptions = {}): AgentTestContext {
  return new AgentTestContext(options);
}

export class AgentTestContext {
  private readonly options: TestAgentOptions;
  private readonly scriptedGenerate = createScriptedGenerate();
  private readonly recordHistory: AgentRecord[] = [];
  private suppressWireSnapshot = false;
  private lastEventCount = 0;
  private readonly uuidLabels = new Map<string, string>();

  readonly emitter = new EventEmitter();
  readonly allEvents: EventSnapshotEntry[] = [];
  readonly agent: Agent;
  readonly rpc: PromiseAgentAPI;
  readonly llmCalls = this.scriptedGenerate.calls;
  readonly lastLlmInput = this.scriptedGenerate.lastInput;
  readonly llmInputs = this.scriptedGenerate.inputs;
  readonly mockNextResponse = this.scriptedGenerate.mockNextResponse;
  readonly mockNextProviderResponse = this.scriptedGenerate.mockNextProviderResponse;

  private kimiConfig: LioraConfig;

  constructor(options: TestAgentOptions = {}) {
    this.options = options;
    this.emitter.on('error', () => {});
    this.kimiConfig = options.initialConfig ?? emptyConfig();
    const providerManager = options.providerManager ?? new ProviderManager({
      config: () => this.kimiConfig,
      ...(options.sessionId !== undefined ? { promptCacheKey: options.sessionId } : {}),
      ...options.providerManagerOverrides,
    });

    const kaos = options.kaos ?? testKaos;
    const persistence = this.wrapPersistence(
      options.persistence ?? new InMemoryAgentRecordPersistence(),
    );
    this.agent = new Agent({
      kaos,
      config: this.kimiConfig,
      rpc: this.createRpcProxy(),
      homedir: options.homedir,
      persistence,
      generate: options.generate ?? this.scriptedGenerate.generate,
      modelProvider: providerManager,
      sessionControl: options.sessionControl,
      type: options.type,
      permission: options.permission,
      telemetry: options.telemetry,
      log: options.log,
    });
    this.rpc = this.createPromiseAgentApi(this.agent);
    onTestFinished(async () => {
      const turn = this.agent.turn.hasActiveTurn ? this.agent.turn.waitForCurrentTurn() : undefined;
      if (turn !== undefined) this.agent.turn.cancel();
      this.agent.fullCompaction.cancel();
      await Promise.all([
        turn,
        this.agent.fullCompaction.waitUntilSettled(),
        this.agent.background.stopAll('test teardown'),
      ]);
      await persistence.close();
    });
  }

  configure({
    provider = MOCK_PROVIDER,
    modelCapabilities,
  }: ConfigureOptions = {}): void {
    this.configureRuntimeModel(provider, modelCapabilities);
    this.agent.config.update({
      cwd: process.cwd(),
      modelAlias: provider.model,
      systemPrompt: DEFAULT_TEST_SYSTEM_PROMPT,
      thinkingLevel: 'off',
    });


    this.lastEventCount = this.allEvents.length;
  }

  configureRuntimeModel(
    provider: ProviderConfig,
    modelCapabilities?: ModelCapability | undefined,
  ): void {
    if (this.options.providerManager === undefined) {
      this.kimiConfig = configWithProvider(this.kimiConfig, provider, modelCapabilities);
    }
    this.agent.config.update({ modelAlias: provider.model });
  }


  newEvents(): ReturnType<typeof eventSnapshot> {
    const events = this.allEvents.slice(this.lastEventCount);
    this.lastEventCount = this.allEvents.length;
    return eventSnapshot(events, this.uuidLabels);
  }

  untilTurnEnd(timeoutMs?: number): Promise<ReturnType<typeof eventSnapshot>> {
    return this.takeUntilRpc('turn.ended', timeoutMs).then(({ events }) => events);
  }

  untilApprovalRequest(timeoutMs?: number): Promise<ReturnType<typeof eventSnapshot>> {
    return this.takeUntilRpc('requestApproval', timeoutMs).then(({ events }) => events);
  }

  async takeApprovalRequest(): Promise<{
    events: ReturnType<typeof eventSnapshot>;
    respond(response: ApprovalResponse): void;
  }> {
    const { event, events } = await this.takeUntilRpc('requestApproval');
    return {
      events,
      respond: (response) => {
        this.resolveRpcRequest(event, response);
      },
    };
  }

  async untilApproval(approved: boolean): Promise<ReturnType<typeof eventSnapshot>> {
    const { event, events } = await this.takeUntilRpc('requestApproval');
    this.resolveRpcRequest(event, {
      decision: approved ? 'approved' : 'rejected',
    } satisfies ApprovalResponse);
    return events;
  }


  dispatch(event: AgentRecord): void {
    this.suppressWireSnapshot = true;
    try {
      this.appendRecord(event);
    } finally {
      this.suppressWireSnapshot = false;
    }
  }

  once(type: string): Promise<void> {
    return new Promise((resolve) => {
      this.emitter.once(type, () => {
        resolve();
      });
    });
  }

  onceAny(types: readonly string[]): Promise<string> {
    return new Promise((resolve) => {
      for (const type of types) {
        this.emitter.once(type, () => {
          resolve(type);
        });
      }
    });
  }

  appendExchange(
    step: number,
    userText: string,
    assistantText: string,
    tokenTotal: number,
  ): void {
    const stepUuid = `step-${String(step)}`;
    this.agent.context.appendUserMessage([{ type: 'text', text: userText }]);
    this.dispatch({
      type: 'context.append_loop_event',
      event: { type: 'step.begin', uuid: stepUuid, turnId: '', step },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'content.part',
        uuid: `part-${String(step)}`,
        turnId: '',
        step,
        stepUuid,
        part: {
          type: 'text',
          text: assistantText,
        },
      },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'step.end',
        uuid: stepUuid,
        turnId: '',
        step,
        usage: {
          inputOther: tokenTotal - 1,
          output: 1,
          inputCacheRead: 0,
          inputCacheCreation: 0,
        },
        finishReason: 'end_turn',
      },
    });
  }

  appendAssistantText(step: number, text: string): void {
    this.appendAssistantTextWithUsage(step, text);
  }

  appendAssistantTextWithUsage(step: number, text: string, tokenTotal?: number): void {
    const stepUuid = `context-step-${String(step)}`;
    const usage =
      tokenTotal === undefined
        ? undefined
        : {
            inputOther: tokenTotal - 1,
            output: 1,
            inputCacheRead: 0,
            inputCacheCreation: 0,
          };
    this.agent.context.appendUserMessage([
      { type: 'text', text: `user before step ${String(step)}` },
    ]);
    this.dispatch({
      type: 'context.append_loop_event',
      event: { type: 'step.begin', uuid: stepUuid, turnId: '', step },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'content.part',
        uuid: `context-part-${String(step)}`,
        turnId: '',
        step,
        stepUuid,
        part: {
          type: 'text',
          text,
        },
      },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'step.end',
        uuid: stepUuid,
        turnId: '',
        step,
        usage,
        finishReason: 'end_turn',
      },
    });
  }


  appendToolExchange(): void {
    const stepUuid = 'context-tool-step';
    this.agent.context.appendUserMessage([{ type: 'text', text: 'lookup something' }]);
    this.dispatch({
      type: 'context.append_loop_event',
      event: { type: 'step.begin', uuid: stepUuid, turnId: '', step: 2 },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'content.part',
        uuid: 'context-tool-part',
        turnId: '',
        step: 2,
        stepUuid,
        part: {
          type: 'text',
          text: 'I will run Bash.',
        },
      },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'tool.call',
        uuid: 'context-tool-call',
        turnId: '',
        step: 2,
        stepUuid,
        toolCallId: 'call_lookup',
        name: 'Bash',
        args: {
          command: 'printf lookup-result',
        },
      },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'step.end',
        uuid: stepUuid,
        turnId: '',
        step: 2,
        finishReason: 'tool_use',
      },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'tool.result',
        parentUuid: 'context-tool-call',
        toolCallId: 'call_lookup',
        result: { output: 'lookup result' },
      },
    });
  }



  appendContextPartiallyResolvedParallelToolExchange(): void {
    const stepUuid = 'context-partial-tool-step';
    this.agent.context.appendUserMessage([{ type: 'text', text: 'run both tools' }]);
    this.dispatch({
      type: 'context.append_loop_event',
      event: { type: 'step.begin', uuid: stepUuid, turnId: '', step: 2 },
    });
    for (const [toolCallId, name] of [
      ['call_open_one', 'Bash'],
      ['call_open_two', 'SessionControl'],
    ] as const) {
      this.dispatch({
        type: 'context.append_loop_event',
        event: {
          type: 'tool.call',
          uuid: toolCallId,
          turnId: '',
          step: 2,
          stepUuid,
          toolCallId,
          name,
          args: name === 'Bash' ? { command: 'printf one' } : { operation: 'list' },
        },
      });
    }
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'step.end',
        uuid: stepUuid,
        turnId: '',
        step: 2,
        finishReason: 'tool_use',
      },
    });
    this.dispatch({
      type: 'context.append_loop_event',
      event: {
        type: 'tool.result',
        parentUuid: 'call_open_one',
        toolCallId: 'call_open_one',
        result: { output: 'one result' },
      },
    });
  }


  compactHistory(): Array<{ readonly role: string; readonly text: string }> {
    return this.agent.context.history.map((message) => ({
      role: message.role,
      text: message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
    }));
  }

  async expectResumeMatches(): Promise<void> {
    const resumed = testAgent({
      kaos: createResumeNoSideEffectKaos(this.agent.config.cwd, this.agent.kaos.pathClass()),
      providerManager: this.options.providerManager,
      initialConfig: this.kimiConfig,
      providerManagerOverrides: this.options.providerManagerOverrides,
      generate: failOnResumeGenerate,
      sessionControl: this.options.sessionControl,
      persistence: new InMemoryAgentRecordPersistence(
        withMetadata(this.recordHistory.map(cloneRecord)),
      ),
    });

    await resumed.agent.resume();

    // oxlint-disable-next-line jest/no-standalone-expect
    expect(resumeStateSnapshot(resumed.agent)).toEqual(resumeStateSnapshot(this.agent));
  }

  private takeUntilRpc(
    method: string,
    timeoutMs?: number,
  ): Promise<{
    event: RpcLogEntry;
    events: ReturnType<typeof eventSnapshot>;
  }> {
    const ready = this.findRpcFromCursor(method);
    if (ready !== undefined) return Promise.resolve(this.takeThrough(ready));

    const promise = createControlledPromise<{
      event: RpcLogEntry;
      events: ReturnType<typeof eventSnapshot>;
    }>();

    // A wall-clock bound keeps a wedged run from holding the suite until the
    // vitest timeout. Left unbounded, a teardown wait turned into a gate
    // failure under load even though the assertion under test had passed.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        this.emitter.off('event', onEvent);
        promise.reject(new Error(`Timed out waiting for RPC ${method}`));
      }, timeoutMs);
    }

    const onEvent = () => {
      const event = this.findRpcFromCursor(method);
      if (event === undefined) return;
      this.emitter.off('event', onEvent);
      if (timer !== undefined) clearTimeout(timer);
      promise.resolve(this.takeThrough(event));
    };
    this.emitter.on('event', onEvent);

    return promise;
  }

  private takeThrough(match: { event: RpcLogEntry; index: number }): {
    event: RpcLogEntry;
    events: ReturnType<typeof eventSnapshot>;
  } {
    const events = this.allEvents.slice(this.lastEventCount, match.index + 1);
    this.lastEventCount = match.index + 1;
    return {
      event: match.event,
      events: eventSnapshot(events, this.uuidLabels),
    };
  }

  private findRpcFromCursor(method: string): { event: RpcLogEntry; index: number } | undefined {
    const index = this.allEvents.findIndex((entry, eventIndex) => {
      return eventIndex >= this.lastEventCount && entry.type === '[rpc]' && entry.event === method;
    });
    if (index === -1) return undefined;

    const event = this.allEvents[index]!;
    return { event: event as RpcLogEntry, index };
  }

  private recordWire(event: AgentRecord): WireSnapshotEntry {
    const { type, ...args } = event;
    const entry: WireSnapshotEntry = {
      type: '[wire]',
      event: type,
      args,
    };
    this.allEvents.push(entry);
    this.emitter.emit(type, entry);
    this.emitter.emit('event', entry);
    return entry;
  }

  private recordRpc(method: string, args: unknown, response?: RpcPromise<unknown>): RpcLogEntry {
    const event: RpcLogEntry = {
      type: '[rpc]',
      event: method,
      args,
      ...(response !== undefined ? { [RPC_RESPONSE]: response } : {}),
    };
    this.allEvents.push(event);
    this.emitter.emit(method, event);
    this.emitter.emit('event', event);
    return event;
  }

  private createRpcPromise<T>(signal?: AbortSignal): RpcPromise<T> {
    const promise = createControlledPromise<T>() as RpcPromise<T>;
    const abort = () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      promise.reject(error);
    };
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }
    return promise;
  }

  private resolveRpcRequest(event: RpcLogEntry, result: unknown): void {
    const response = event[RPC_RESPONSE];
    if (response === undefined) {
      throw new Error(`RPC ${event.event} does not have a pending response`);
    }
    response.resolve(result);
  }

  private createRpcProxy(): SDKAgentRPC {
    return new Proxy(
      {},
      {
        get: (_target, property) => {
          if (typeof property !== 'string') return;
          return (payload: unknown, options?: RPCCallOptions) => {
            if (property === 'emitEvent') {
              const event = payload;
              if (!this.isRpcEvent(event)) {
                throw new TypeError('rpc.emitEvent expected an event object');
              }
              const { type, ...eventPayload } = event;
              this.recordRpc(type, eventPayload);
              return;
            }

            const promise = this.createRpcPromise(options?.signal);
            void promise.catch(() => {});
            this.recordRpc(property, payload, promise);
            options?.signal?.throwIfAborted();
            return promise;
          };
        },
      },
    ) as SDKAgentRPC;
  }

  private isRpcEvent(value: unknown): value is { readonly type: string } {
    return (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as { readonly type?: unknown }).type === 'string'
    );
  }

  private appendRecord(event: AgentRecord): void {
    const records = this.agent.records;
    records.logRecord(event);
    records.restore(event);
  }

  private wrapPersistence(persistence: AgentRecordPersistence): AgentRecordPersistence {
    return {
      read: () => this.readAndCapturePersistence(persistence),
      append: (event) => {
        this.captureRecord(event);
        persistence.append(event);
      },
      rewrite: (records) => {
        persistence.rewrite(records);
      },
      flush: () => persistence.flush(),
      close: () => persistence.close(),
      flushSync: () =>{  persistence.flushSync(); },
      recordCount: () => persistence.recordCount(),
    };
  }

  private async *readAndCapturePersistence(
    persistence: AgentRecordPersistence,
  ): AsyncIterable<AgentRecord> {
    for await (const event of persistence.read()) {
      this.recordHistory.push(cloneRecord(event));
      yield event;
    }
  }

  private captureRecord(event: AgentRecord): void {
    const cloned = cloneRecord(event);
    this.recordHistory.push(cloned);
    if (this.suppressWireSnapshot) return;

    this.recordWire(cloned);
    const response = this.options.onEvent?.(cloned);
    if (response !== undefined) {
      this.dispatch(response);
    }
  }

  private createPromiseAgentApi(agent: Agent): PromiseAgentAPI {
    const target = agent.rpcMethods;
    return new Proxy(target, {
      get(proxyTarget, property, receiver) {
        const value = Reflect.get(proxyTarget, property, receiver);
        if (typeof value !== 'function') return value;
        return (payload: unknown) => {
          try {
            return Promise.resolve(value.call(proxyTarget, payload));
          } catch (error) {
            return Promise.reject(error);
          }
        };
      },
    }) as unknown as PromiseAgentAPI;
  }
}

const failOnResumeGenerate: GenerateFn = async () => {
  throw new Error('Resume replay unexpectedly called the LLM');
};

function createResumeNoSideEffectKaos(
  initialCwd: string,
  pathClass: 'posix' | 'win32',
): Kaos {
  const fail = (method: string): never => {
    throw new Error(`Resume replay unexpectedly called kaos.${method}`);
  };

  // Replay may carry `config.update({cwd})` events. Restore remounts via
  // `withCwd` (no filesystem `chdir`/`stat`) so a deleted worktree cannot
  // crash resume. Keep `chdir` as an in-memory fallback for older paths.
  // Actual fs I/O methods remain forbidden. `pathClass` mirrors
  // the live agent's kaos so platform-conditional tool descriptions (e.g.
  // Glob's Windows note) match the original in `expectResumeMatches`.
  let cwd = initialCwd;
  return {
    name: 'resume-no-side-effects',
    osEnv: TEST_OS_ENV,
    pathClass: () => pathClass,
    normpath: (p: string) => p,
    gethome: () => '/home/test',
    getcwd: () => cwd,
    withCwd: (next: string) => createResumeNoSideEffectKaos(next, pathClass),
    withEnv: () => createResumeNoSideEffectKaos(cwd, pathClass),
    chdir: async (next: string) => {
      cwd = next;
    },
    stat: () => fail('stat'),
    realpath: async (p: string) => p,
    iterdir: () => fail('iterdir'),
    glob: () => fail('glob'),
    readBytes: () => fail('readBytes'),
    readText: () => fail('readText'),
    readLines: () => fail('readLines'),
    writeBytes: () => fail('writeBytes'),
    writeText: () => fail('writeText'),
    mkdir: () => fail('mkdir'),
    unlink: () => fail('unlink'),
    rename: () => fail('rename'),
    writeAtomic: () => fail('writeAtomic'),
    exec: () => fail('exec'),
    execWithEnv: () => fail('execWithEnv'),
  };
}

function resumeStateSnapshot(agent: Agent): ResumeStateSnapshot {
  return {
    background: agent.background.list(false),
    config: configStateSnapshot(agent),
    context: agent.context.data(),
    permission: agent.permission.data(),
    usage: agent.usage.data(),
  };
}


function configStateSnapshot(agent: Agent): ResumeStateSnapshot['config'] {
  let provider: ProviderConfig | undefined;
  try {
    provider = agent.config.providerConfig;
  } catch {}

  return {
    cwd: agent.config.cwd.replaceAll('\\', '/'),
    provider,
    profileName: agent.config.profileName,
    thinkingLevel: agent.config.thinkingLevel,
    systemPrompt: agent.config.systemPrompt,
  };
}

function emptyConfig(): LioraConfig {
  return configWithProvider({ providers: {} }, MOCK_PROVIDER, undefined);
}

function configWithProvider(
  config: LioraConfig,
  provider: ProviderConfig,
  modelCapabilities: ModelCapability | undefined,
): LioraConfig {
  const providerName = 'test-provider';
  const maxContextSize = modelCapabilities?.max_context_tokens;
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerName]: providerConfigForAlias(provider),
    },
    models: {
      ...config.models,
      [provider.model]: {
        provider: providerName,
        model: provider.model,
        maxContextSize:
          maxContextSize === undefined || maxContextSize <= 0 ? 1_000_000 : maxContextSize,
        capabilities: capabilityNames(modelCapabilities),
      },
    },
  };
}

function providerConfigForAlias(provider: ProviderConfig): LioraConfig['providers'][string] {
  return {
    type: provider.type,
    apiKey: 'apiKey' in provider ? provider.apiKey : undefined,
    baseUrl: 'baseUrl' in provider ? provider.baseUrl : undefined,
  };
}

function capabilityNames(capabilities: ModelCapability | undefined): string[] {
  if (capabilities === undefined) return [];
  return [
    capabilities.image_in ? 'image_in' : undefined,
    capabilities.video_in ? 'video_in' : undefined,
    capabilities.audio_in ? 'audio_in' : undefined,
    capabilities.pdf_in ? 'pdf_in' : undefined,
    capabilities.thinking ? 'thinking' : undefined,
    capabilities.tool_use ? 'tool_use' : undefined,
  ].filter((capability): capability is string => capability !== undefined);
}


function cloneRecord(event: AgentRecord): AgentRecord {
  return structuredClone(event);
}

function withMetadata(events: readonly AgentRecord[]): readonly AgentRecord[] {
  if (events.length === 0 || events[0]?.type === 'metadata') return events;
  return [
    {
      type: 'metadata',
      protocol_version: AGENT_WIRE_PROTOCOL_VERSION,
      created_at: 1,
    },
    ...events,
  ];
}
