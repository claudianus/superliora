import type { SessionControlHost } from '../../src/tools/builtin/session-control';
import { dirname } from 'node:path';
import { LocalKaos } from '@superliora/kaos';
import * as localSandbox from '../../../kaos/src/process-sandbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, SandboxExecutionError } from '../../src/agent';
import { ToolManager } from '../../src/agent/tool';
import * as sandbox from '../../src/tools/policies/process-sandbox-apply';
import { AGENT_WIRE_PROTOCOL_VERSION, InMemoryAgentRecordPersistence } from '../../src/agent/records';
import { testKaos } from '../fixtures/test-kaos';
import type { ResolveProcessSandboxRuntimeResult } from '../../src/tools/policies/process-sandbox-apply';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const confined: ResolveProcessSandboxRuntimeResult = {
  status: { desired: 'process', effective: 'process', backend: 'docker' },
  config: { backend: 'docker', workspaceDir: process.cwd() },
};
function mockTool(agent: Agent) {
  const execute = vi.fn(async () => ({ output: 'executed' }));
  vi.spyOn(ToolManager.prototype, 'loopTools', 'get').mockReturnValue([{
    name: 'Test', description: 'test', parameters: { type: 'object', properties: {} },
    resolveExecution: vi.fn(() => ({ execute, approvalRule: 'Test' })),
  }]);
  return { tool: agent.tools.loopTools[0]!, execute };
}
afterEach(() => vi.restoreAllMocks());

describe('Agent process sandbox lifecycle', () => {
  it('blocks standalone startup turns and tools pending a probe, then fails closed', async () => {
    const probe = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockReturnValue(probe.promise);
    const apply = vi.spyOn(sandbox, 'applyProcessSandboxToKaos');
    const agent = new Agent({ kaos: testKaos, sandboxEnforcement: 'process' });
    const { tool, execute } = mockTool(agent);
    expect(agent.sandboxState).toBe('pending');
    expect(() => agent.turn.prompt([])).toThrow(SandboxExecutionError);
    expect(() => agent.turn.steer([])).toThrow(/pending/);
    await expect(tool.resolveExecution({})).rejects.toMatchObject({ code: 'sandbox.pending' });
    await expect(agent.tools.runShellCommand('echo forbidden')).rejects.toMatchObject({ code: 'sandbox.pending' });
    probe.reject(new Error('Docker unavailable'));
    await expect(agent.waitForSandbox()).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(agent.sandboxEnforcement).toBe('process');
    expect(agent.processSandboxStatus).toBeUndefined();
    expect(agent.sandboxState).toBe('error');
    expect(() => agent.turn.prompt([])).toThrow(/Docker unavailable/);
    await expect(tool.resolveExecution({})).rejects.toThrow(/Docker unavailable/);
    expect(execute).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('rechecks a resolved tool after a live update and permits explicit lexical recovery', async () => {
    const agent = new Agent({ kaos: testKaos });
    const { tool, execute } = mockTool(agent);
    const execution = await tool.resolveExecution({});
    if (!('execute' in execution)) throw new Error('Expected executable tool');
    const probe = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockReturnValue(probe.promise);
    agent.setSandboxEnforcement('process');
    const activation = agent.waitForSandbox();
    const context = { turnId: '', toolCallId: '', signal: new AbortController().signal, onUpdate: vi.fn() };
    await expect(execution.execute(context)).rejects.toMatchObject({ code: 'sandbox.pending' });
    probe.reject(new Error('no confinement'));
    await expect(activation).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    await expect(execution.execute(context)).rejects.toThrow(/no confinement/);
    await agent.setSandboxPolicy({ profile: 'off', enforcement: 'lexical' });
    expect(agent.sandboxState).toBe('ready');
    expect(agent.sandboxProfile).toBe('off');
    await expect(execution.execute(context)).rejects.toMatchObject({ code: 'sandbox.stale' });
    const fresh = await agent.tools.loopTools[0]!.resolveExecution({});
    if (!('execute' in fresh)) throw new Error('Expected executable tool');
    await fresh.execute(context);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not apply stale probes after a newer policy or host change', async () => {
    const first = deferred<ResolveProcessSandboxRuntimeResult>();
    const second = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime')
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const apply = vi.spyOn(sandbox, 'applyProcessSandboxToKaos');
    const agent = new Agent({ kaos: testKaos, sandboxEnforcement: 'process' });
    const host = testKaos.withCwd(process.cwd());
    agent.setKaos(host);
    const update = agent.waitForSandbox();
    first.resolve(confined);
    await Promise.resolve();
    expect(agent.sandboxState).toBe('pending');
    expect(apply).not.toHaveBeenCalled();
    second.resolve(confined);
    await update;
    expect(apply).toHaveBeenCalledTimes(1);
    const installedHost = apply.mock.calls[0]![0];
    expect(installedHost).not.toBe(host);
    expect(apply).toHaveBeenCalledExactlyOnceWith(installedHost, confined.config);
    expect(agent.processSandboxStatus?.effective).toBe('process');
    const third = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.mocked(sandbox.resolveProcessSandboxRuntime).mockReturnValueOnce(third.promise);
    agent.setSandboxProfile('read-only');
    const stale = agent.waitForSandbox();
    agent.setSandboxEnforcement('lexical');
    await agent.waitForSandbox();
    third.resolve(confined);
    await stale;
    expect(agent.processSandboxStatus?.effective).toBe('lexical');
    expect(apply).toHaveBeenLastCalledWith(installedHost, undefined);
  });

  it('rejects tools and executions cached on a lexical host after successful process upgrade', async () => {
    const agent = new Agent({ kaos: testKaos });
    const { tool, execute } = mockTool(agent);
    const execution = await tool.resolveExecution({});
    if (!('execute' in execution)) throw new Error('Expected executable tool');
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockResolvedValue(confined);
    agent.setSandboxEnforcement('process');
    await agent.waitForSandbox();
    expect(agent.sandboxState).toBe('ready');
    await expect(tool.resolveExecution({})).rejects.toMatchObject({ code: 'sandbox.stale' });
    await expect(execution.execute({ turnId: '', toolCallId: '', signal: new AbortController().signal, onUpdate: vi.fn() }))
      .rejects.toMatchObject({ code: 'sandbox.stale' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('waits for startup and the final replayed cwd configuration during strict resume', async () => {
    const startup = deferred<ResolveProcessSandboxRuntimeResult>();
    const firstCwd = deferred<ResolveProcessSandboxRuntimeResult>();
    const finalCwd = deferred<ResolveProcessSandboxRuntimeResult>();
    const resolver = vi.spyOn(sandbox, 'resolveProcessSandboxRuntime')
      .mockReturnValueOnce(startup.promise)
      .mockReturnValueOnce(firstCwd.promise)
      .mockReturnValueOnce(finalCwd.promise);
    const persistence = new InMemoryAgentRecordPersistence([
      { type: 'metadata', protocol_version: AGENT_WIRE_PROTOCOL_VERSION, created_at: 1 },
      { type: 'config.update', cwd: '/workspace/first' },
      { type: 'config.update', cwd: '/workspace/final' },
    ]);
    const agent = new Agent({ kaos: testKaos.withCwd(process.cwd()), persistence, sandboxEnforcement: 'process' });
    let finished = false;
    const resumed = agent.resume().then(result => { finished = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    startup.resolve(confined);
    await vi.waitFor(() => { expect(resolver).toHaveBeenCalledTimes(3); });
    expect(agent.config.cwd).toBe('/workspace/final');
    expect(agent.sandboxState).toBe('pending');
    expect(finished).toBe(false);
    firstCwd.resolve(confined);
    await Promise.resolve();
    expect(agent.sandboxState).toBe('pending');
    finalCwd.resolve({ ...confined, config: { backend: 'docker', workspaceDir: '/workspace/final' } });
    await expect(resumed).resolves.toEqual({});
    expect(agent.kaos.getcwd()).toBe('/workspace/final');
    expect(agent.sandboxState).toBe('ready');
  });

  it('constructs native Bash during deferred startup and live policy updates', async () => {
    const startup = deferred<ResolveProcessSandboxRuntimeResult>();
    const update = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime')
      .mockReturnValueOnce(startup.promise).mockReturnValueOnce(update.promise);
    const agent = new Agent({ kaos: testKaos.withCwd(process.cwd()), sandboxEnforcement: 'process' });
    const retained = agent.tools.builtinTools.get('Bash')!;
    expect(agent.sandboxState).toBe('pending');
    await expect(retained.resolveExecution({ command: 'echo forbidden' })).rejects.toMatchObject({ code: 'sandbox.pending' });
    startup.resolve(confined);
    await agent.ensureSandboxReady();
    const execution = await agent.tools.builtinTools.get('Bash')!.resolveExecution({ command: 'echo safe' });
    expect('execute' in execution).toBe(true);
    agent.setSandboxProfile('read-only');
    const activation = agent.waitForSandbox();
    expect(agent.sandboxState).toBe('pending');
    update.resolve(confined);
    await activation;
    await expect(retained.resolveExecution({ command: 'echo forbidden' })).rejects.toMatchObject({ code: 'sandbox.stale' });
    expect(agent.tools.builtinTools.has('Bash')).toBe(true);
  });

  it('rebuilds builtin guards on the current revision after lexical, process, and host updates', async () => {
    const agent = new Agent({ kaos: testKaos });
    const execute = vi.fn(async () => ({ output: 'safe' }));
    vi.spyOn(ToolManager.prototype, 'initializeBuiltinTools').mockImplementation(function (this: ToolManager) {
      this.builtinTools = new Map([['Test', {
        name: 'Test', description: 'test', parameters: { type: 'object', properties: {} },
        resolveExecution: () => ({ approvalRule: 'Test', execute }),
      }]]);
    });
    const context = { turnId: '', toolCallId: '', signal: new AbortController().signal, onUpdate: vi.fn() };
    const runFresh = async () => {
      const tool = agent.tools.builtinTools.get('Test')!;
      const execution = await tool.resolveExecution({});
      if (!('execute' in execution)) throw new Error('Expected executable tool');
      await execution.execute(context);
    };
    agent.setSandboxProfile('workspace');
    await agent.waitForSandbox();
    await runFresh();
    const old = agent.tools.builtinTools.get('Test')!;
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockResolvedValue(confined);
    agent.setSandboxEnforcement('process');
    await agent.waitForSandbox();
    await runFresh();
    await expect(old.resolveExecution({})).rejects.toMatchObject({ code: 'sandbox.stale' });
    agent.setKaos(testKaos.withCwd(process.cwd()));
    await agent.waitForSandbox();
    await runFresh();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('rejects pending clones and preserves process gates on retained cwd/env clones', async () => {
    const raw = testKaos.withCwd(process.cwd());
    const spawn = vi.spyOn(LocalKaos.prototype, 'exec').mockRejectedValue(new Error('unexpected host execution'));
    const agent = new Agent({ kaos: raw });
    const cwdClone = agent.kaos.withCwd(process.cwd());
    const envClone = agent.kaos.withEnv({ EXAMPLE: 'value' });
    const probe = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockReturnValue(probe.promise);
    agent.setSandboxEnforcement('process');
    const activation = agent.waitForSandbox();
    expect(() => agent.kaos.withCwd(process.cwd())).toThrow(/pending/);
    expect(() => agent.kaos.withEnv({})).toThrow(/pending/);
    await expect(cwdClone.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.pending' });
    await expect(envClone.execWithEnv(['forbidden'])).rejects.toMatchObject({ code: 'sandbox.pending' });
    probe.resolve(confined);
    await activation;
    await expect(cwdClone.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.stale' });
    await expect(envClone.execWithEnv(['forbidden'])).rejects.toMatchObject({ code: 'sandbox.stale' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('blocks activation when the execution host refuses confinement', async () => {
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockResolvedValue(confined);
    vi.spyOn(sandbox, 'applyProcessSandboxToKaos').mockImplementation((_, config) => {
      if (config) throw new Error('Unsupported host');
    });
    const agent = new Agent({ kaos: testKaos });
    agent.setSandboxEnforcement('process');
    await expect(agent.waitForSandbox()).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(agent.processSandboxStatus).toBeUndefined();
    expect(() => { agent.assertSandboxReady(); }).toThrow(/Unsupported host/);
  });

  it('observes ignored constructor and legacy setter rejections without clearing the gate', async () => {
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockRejectedValue(new Error('missing Docker'));
    const agent = new Agent({ kaos: testKaos, sandboxEnforcement: 'process' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(agent.sandboxState).toBe('error');
    agent.setKaos(testKaos.withCwd(process.cwd()));
    await new Promise((resolve) => setImmediate(resolve));
    expect(() => { agent.assertSandboxReady(); }).toThrow(/missing Docker/);
  });

  it('keeps lexical startup immediately ready without a backend probe', async () => {
    const resolver = vi.spyOn(sandbox, 'resolveProcessSandboxRuntime');
    const agent = new Agent({ kaos: testKaos });
    expect(agent.sandboxState).toBe('ready');
    agent.assertSandboxReady();
    await agent.ensureSandboxReady();
    const execution = await agent.tools.builtinTools.get('Bash')!.resolveExecution({ command: 'echo safe' });
    expect('execute' in execution).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('invalidates an asynchronous resolution completed across a policy update', async () => {
    const agent = new Agent({ kaos: testKaos });
    const execute = vi.fn(async () => ({ output: 'forbidden' }));
    const resolution = deferred<{ execute: typeof execute; approvalRule: string }>();
    vi.spyOn(ToolManager.prototype, 'loopTools', 'get').mockReturnValue([{
      name: 'Deferred', description: 'deferred tool', parameters: { type: 'object', properties: {} },
      resolveExecution: () => resolution.promise,
    }]);
    const result = agent.tools.loopTools[0]!.resolveExecution({});
    agent.setAdditionalDirs([process.cwd()]);
    await agent.waitForSandbox();
    resolution.resolve({ execute, approvalRule: 'Deferred' });
    await expect(result).rejects.toMatchObject({ code: 'sandbox.stale' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('waits for the latest host generation even when an obsolete probe rejects', async () => {
    const first = deferred<ResolveProcessSandboxRuntimeResult>();
    const final = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime')
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(final.promise);
    const agent = new Agent({ kaos: testKaos, sandboxEnforcement: 'process' });
    let finished = false;
    const waiting = agent.ensureSandboxReady().then(() => { finished = true; });
    const update = agent.setKaosCwd(process.cwd());
    first.reject(new Error('obsolete host failed'));
    await new Promise(resolve => setImmediate(resolve));
    expect(finished).toBe(false);
    expect(agent.sandboxState).toBe('pending');
    final.resolve(confined);
    await update;
    await waiting;
    expect(finished).toBe(true);
    expect(agent.sandboxFailure).toBeUndefined();
  });

  it('blocks direct process calls pending and after failure, and invalidates retained hosts', async () => {
    const raw = testKaos.withCwd(process.cwd());
    const exec = vi.spyOn(LocalKaos.prototype, 'exec').mockRejectedValue(new Error('fresh host reached'));
    const execWithEnv = vi.spyOn(LocalKaos.prototype, 'execWithEnv').mockRejectedValue(new Error('fresh host reached'));
    const agent = new Agent({ kaos: raw });
    const retained = agent.kaos;
    const probe = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockReturnValue(probe.promise);
    agent.setSandboxEnforcement('process');
    const activation = agent.waitForSandbox();
    await expect(agent.kaos.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.pending' });
    await expect(agent.kaos.execWithEnv(['forbidden'])).rejects.toMatchObject({ code: 'sandbox.pending' });
    probe.reject(new Error('confinement unavailable'));
    await expect(activation).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    await expect(agent.kaos.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    await expect(agent.kaos.execWithEnv(['forbidden'])).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(exec).not.toHaveBeenCalled();
    expect(execWithEnv).not.toHaveBeenCalled();
    agent.setSandboxEnforcement('lexical');
    await agent.waitForSandbox();
    await expect(retained.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.stale' });
    await expect(agent.kaos.exec('fresh')).rejects.toThrow('fresh host reached');
    await expect(agent.kaos.execWithEnv(['fresh'])).rejects.toThrow('fresh host reached');
    expect(exec).toHaveBeenCalledExactlyOnceWith('fresh');
    expect(execWithEnv).toHaveBeenCalledExactlyOnceWith(['fresh']);
  });

  it('rejects resolved results that do not actually promise process confinement', async () => {
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockResolvedValue({
      status: { desired: 'process', effective: 'lexical', warning: 'supervisor only' },
    });
    const apply = vi.spyOn(sandbox, 'applyProcessSandboxToKaos');
    const agent = new Agent({ kaos: testKaos, sandboxEnforcement: 'process' });
    await expect(agent.ensureSandboxReady()).rejects.toThrow('supervisor only');
    expect(apply).not.toHaveBeenCalled();
    expect(agent.sandboxState).toBe('error');
  });

  it('forks policy per Agent installation while preserving same-Agent cwd/env views', async () => {
    const configurations: unknown[] = [];
    vi.spyOn(localSandbox, 'wrapLocalExecForProcessSandbox').mockImplementation(opts => {
      configurations.push(opts.config);
      return { file: process.execPath, args: ['-e', 'process.exit(0)'] };
    });
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockImplementation(async opts => ({
      status: { desired: 'process', effective: 'process', backend: 'docker' },
      config: { backend: 'docker', workspaceDir: opts.workspaceDir, additionalDirs: opts.additionalDirs,
        readOnly: opts.profile === 'read-only' },
    }));
    const shared = testKaos.withCwd(process.cwd());
    const first = new Agent({ kaos: shared, sandboxEnforcement: 'process', sandboxProfile: 'read-only' });
    await first.ensureSandboxReady();
    const generation = first.sandboxGeneration;
    const firstView = first.kaos.withCwd(process.cwd()).withEnv({ EXAMPLE: '1' });
    // Installing a lexical Agent from either the raw host or another facade
    // must never clear an already-ready Agent's process confinement.
    const second = new Agent({ kaos: shared, sandboxEnforcement: 'lexical' });
    const third = new Agent({ kaos: first.kaos, sandboxEnforcement: 'lexical' });
    for (const agent of [second, third]) {
      await agent.ensureSandboxReady();
      await (await agent.kaos.exec('echo', 'test')).wait();
      expect(configurations.at(-1)).toBeUndefined();
    }
    const assertFirst = async () => {
      await (await firstView.exec('echo', 'test')).wait();
      expect(configurations.at(-1)).toMatchObject({ backend: 'docker', workspaceDir: process.cwd(), readOnly: true,
        additionalDirs: [] });
      expect(first.sandboxGeneration).toBe(generation);
      expect(first.sandboxState).toBe('ready');
    };
    await assertFirst();
    await second.setSandboxPolicy({ enforcement: 'process', profile: 'workspace' });
    second.setAdditionalDirs(['/example-extra']);
    second.config.update({ cwd: dirname(process.cwd()) });
    await second.ensureSandboxReady();
    await (await second.kaos.exec('echo', 'test')).wait();
    expect(configurations.at(-1)).toMatchObject({ workspaceDir: dirname(process.cwd()), readOnly: false, additionalDirs: ['/example-extra'] });
    await assertFirst();
    // Host replacement also forks, rather than joining a sibling's mutable policy.
    second.setKaos(first.kaos);
    await second.ensureSandboxReady();
    second.setSandboxEnforcement('lexical');
    await second.ensureSandboxReady();
    await assertFirst();
  });

  it('blocks the old host after a new mutable host refuses isolated installation', async () => {
    const agent = new Agent({ kaos: testKaos });
    const retained = agent.kaos;
    const host = { setProcessSandbox: vi.fn() };
    // Prototype methods are irrelevant: policy installation must reject this
    // host before deriving cwd views or executing any process.
    agent.setKaos(host as unknown as LocalKaos);
    await expect(agent.ensureSandboxReady()).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(host.setProcessSandbox).not.toHaveBeenCalled();
    await expect(retained.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    agent.setKaos(testKaos);
    await agent.ensureSandboxReady();
    await expect(retained.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.stale' });
    expect(agent.sandboxState).toBe('ready');
  });

  it('allows only native SessionControl snapshots and stop through pending/error recovery', async () => {
    const probe = deferred<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockReturnValue(probe.promise);
    const host: SessionControlHost = {
      listActive: vi.fn(() => []), stopAndJoin: vi.fn(async () => true),
      spawn: vi.fn(), resume: vi.fn(), steerChild: vi.fn(() => false), markActiveChildDetached: vi.fn(),
    };
    const agent = new Agent({ kaos: testKaos, sandboxEnforcement: 'process', sessionControl: host });
    const tool = agent.tools.builtinTools.get('SessionControl')!;
    const context = { turnId: '', toolCallId: '', signal: new AbortController().signal, onUpdate: vi.fn() };
    const execute = async (input: unknown) => {
      const execution = await tool.resolveExecution(input);
      if (!('execute' in execution)) throw new Error('Expected executable lifecycle operation');
      return execution.execute(context);
    };
    expect((await execute({ operation: 'list' })).output).toContain('sessions');
    expect(await execute({ operation: 'wait', id: 'missing', timeout: 0 })).toMatchObject({
      output: 'Session or task not found: missing',
    });
    await expect(agent.tools.builtinTools.get('Bash')!.resolveExecution({ command: 'echo unsafe' }))
      .rejects.toMatchObject({ code: 'sandbox.pending' });
    probe.reject(new Error('Docker failed'));
    await expect(agent.ensureSandboxReady()).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(await execute({ operation: 'stop', id: 'existing-child' })).toMatchObject({
      output: expect.stringContaining('resourcesSettled'),
    });
    expect(host.stopAndJoin).toHaveBeenCalledExactlyOnceWith('existing-child', undefined);
    for (const operation of ['spawn', 'message', 'compact', 'verify']) {
      await expect(tool.resolveExecution({ operation, id: 'child', prompt: 'unsafe', description: 'unsafe', message: 'unsafe' }))
        .rejects.toMatchObject({ code: 'sandbox.unavailable' });
    }
    await expect(agent.tools.builtinTools.get('Bash')!.resolveExecution({ command: 'echo unsafe' }))
      .rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(() => agent.turn.prompt([])).toThrow(/Docker failed/);
    const mutable = { operation: 'list' };
    const snapshot = await tool.resolveExecution(mutable);
    mutable.operation = 'spawn';
    if (!('execute' in snapshot)) throw new Error('Expected recovery snapshot');
    expect((await snapshot.execute(context)).output).toContain('sessions');
    expect(host.spawn).not.toHaveBeenCalled();
    expect(host.resume).not.toHaveBeenCalled();
    const customExecute = vi.fn(async () => ({ output: 'unsafe' }));
    vi.spyOn(ToolManager.prototype, 'loopTools', 'get').mockReturnValue([{
      name: 'SessionControl', description: 'custom impostor', parameters: { type: 'object' },
      resolveExecution: () => ({ execute: customExecute, approvalRule: 'SessionControl' }),
    }]);
    await expect(agent.tools.loopTools[0]!.resolveExecution({ operation: 'list' }))
      .rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(customExecute).not.toHaveBeenCalled();
  });

});
